import crypto from 'node:crypto';
import { pool } from './db.js';
import {
  callTelegramBotApi,
  getTelegramBotConfig,
  sendTelegramLongMessage,
  sendTelegramMessage,
} from './notifications.js';
import {
  createConfiguredOperationalManager,
  getOperationalAgentConfig,
} from './agent/operational-manager.js';
import { clearAgentConversation } from './agent/conversations.js';
import {
  buildSalesSummaryMessage,
  loadSalesSummary,
  normalizeDateKey,
  shiftDateKey,
} from './sales-summary.js';

const enabled = (process.env.TELEGRAM_AGENT_ENABLED || '').trim().toLowerCase() === 'true';
const webhookSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_ORIGIN || '')
  .trim()
  .replace(/\/+$/, '');
const dailyReportTime = (process.env.TELEGRAM_DAILY_REPORT_TIME || '09:00').trim();
const fallbackTimeZone = (process.env.DEFAULT_TIMEZONE || 'Asia/Riyadh').trim();
const configuredAgentChatIds = (
  process.env.TELEGRAM_AGENT_CHAT_IDS ||
  process.env.TELEGRAM_CHAT_ID ||
  process.env.TELEGRAM_ORDER_CHAT_ID ||
  process.env.ORDER_NOTIFY_TELEGRAM_CHAT_ID ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const operationalManagers = new Map();

function getOperationalManager(timeZone) {
  const key = String(timeZone || fallbackTimeZone);
  if (!operationalManagers.has(key)) {
    operationalManagers.set(
      key,
      createConfiguredOperationalManager({
        timeZone: key,
      })
    );
  }
  return operationalManagers.get(key);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function datePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    dateKey: `${parts.year}${parts.month}${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

async function getSetting(key, fallback) {
  const [rows] = await pool.execute('SELECT `value` FROM app_settings WHERE `key` = ? LIMIT 1', [key]);
  return rows?.[0]?.value != null ? String(rows[0].value) : fallback;
}

async function setSetting(key, value, db = pool) {
  await db.execute(
    `INSERT INTO app_settings (\`key\`, \`value\`, updatedAt)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updatedAt = VALUES(updatedAt)`,
    [key, String(value), Date.now()]
  );
}

async function sendReport(chatId, dateKey) {
  const summary = await loadSalesSummary(dateKey);
  const previous = await loadSalesSummary(shiftDateKey(dateKey, -1));
  await sendTelegramMessage(chatId, buildSalesSummaryMessage(summary, previous));
}

function helpMessage() {
  return [
    'SIGHT operational manager',
    '',
    '/today — today’s sales',
    '/yesterday — yesterday’s sales',
    '/report YYYY-MM-DD — report for a date',
    '/operations — current sales and inventory briefing',
    '/reset — clear conversational context',
    '/help — show these commands',
    '',
    'You can also ask naturally in English or Arabic:',
    '“What inventory should I worry about?”',
    '“Compare this week with last week.”',
  ].join('\n');
}

function parseCommand(text, todayDateKey) {
  const raw = String(text || '').trim();
  const command = raw.split(/\s+/)[0].toLowerCase().split('@')[0];
  if (command === '/start' || command === '/help') return { type: 'help' };
  if (command === '/today' || /^(today|sales today)$/i.test(raw)) {
    return { type: 'report', dateKey: todayDateKey };
  }
  if (command === '/yesterday' || command === '/daily' || /^(yesterday|sales yesterday)$/i.test(raw)) {
    return { type: 'report', dateKey: shiftDateKey(todayDateKey, -1) };
  }
  if (command === '/report') {
    const requestedDate = raw.split(/\s+/)[1];
    return { type: 'report', dateKey: normalizeDateKey(requestedDate) };
  }
  if (command === '/operations' || command === '/briefing') return { type: 'operations' };
  if (command === '/reset') return { type: 'reset' };
  return { type: 'unknown' };
}

export function getTelegramAgentStatus() {
  const botConfig = getTelegramBotConfig();
  const operationalAgent = getOperationalAgentConfig();
  const webhookSecretValid = /^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret);
  const publicBaseUrlValid = publicBaseUrl.startsWith('https://');
  return {
    enabled,
    ready:
      enabled &&
      botConfig.botTokenConfigured &&
      configuredAgentChatIds.length > 0 &&
      webhookSecretValid &&
      publicBaseUrlValid,
    botTokenConfigured: botConfig.botTokenConfigured,
    chatCount: configuredAgentChatIds.length,
    webhookSecretConfigured: Boolean(webhookSecret),
    webhookSecretValid,
    publicBaseUrlConfigured: Boolean(publicBaseUrl),
    publicBaseUrlValid,
    dailyReportTime,
    operationalAgent,
  };
}

export async function handleTelegramUpdate(update, receivedSecret) {
  if (!enabled) return { status: 503, body: { error: 'Telegram agent is disabled' } };
  if (!webhookSecret || !safeEqual(receivedSecret, webhookSecret)) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  const message = update?.message;
  const chatId = message?.chat?.id != null ? String(message.chat.id) : '';
  if (!chatId || !configuredAgentChatIds.includes(chatId) || typeof message?.text !== 'string') {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  try {
    const timeZone = await getSetting('timeZone', fallbackTimeZone);
    const operationalManager = getOperationalManager(timeZone);
    const { dateKey } = datePartsInTimeZone(new Date(), timeZone);
    const parsed = parseCommand(message.text, dateKey);
    if (parsed.type === 'help') {
      await sendTelegramMessage(chatId, helpMessage());
    } else if (parsed.type === 'report' && parsed.dateKey) {
      await sendReport(chatId, parsed.dateKey);
    } else if (parsed.type === 'report') {
      await sendTelegramMessage(chatId, 'Use /report YYYY-MM-DD, for example /report 2026-07-21.');
    } else if (parsed.type === 'reset') {
      await clearAgentConversation('telegram', chatId);
      await sendTelegramMessage(chatId, 'Conversation context cleared. Business data was not changed.');
    } else if (parsed.type === 'operations' && operationalManager) {
      const answer = await operationalManager.answer({
        channel: 'telegram',
        externalId: chatId,
        text:
          message.text.trim().split(/\s+/).length > 1
            ? message.text
            : 'Give me a concise operational briefing for today covering sales, open orders, inventory risks, and data-quality warnings.',
        requestId: update?.update_id != null ? String(update.update_id) : null,
      });
      await sendTelegramLongMessage(chatId, answer.text);
    } else if (parsed.type === 'unknown' && operationalManager) {
      const answer = await operationalManager.answer({
        channel: 'telegram',
        externalId: chatId,
        text: message.text,
        requestId: update?.update_id != null ? String(update.update_id) : null,
      });
      await sendTelegramLongMessage(chatId, answer.text);
    } else {
      await sendTelegramMessage(
        chatId,
        `${helpMessage()}\n\nNatural-language operations questions are unavailable until the OpenAI operational-agent settings are configured.`
      );
    }
    return { status: 200, body: { ok: true } };
  } catch (error) {
    console.error('Telegram agent command failed', error);
    await sendTelegramMessage(chatId, 'I could not load the sales report. Please try again.').catch(
      () => {}
    );
    return { status: 200, body: { ok: false } };
  }
}

async function deliverDailyReportIfDue(now = new Date()) {
  if (!getTelegramAgentStatus().ready) return false;
  const scheduledMinutes = timeToMinutes(dailyReportTime);
  if (scheduledMinutes == null) return false;

  const timeZone = await getSetting('timeZone', fallbackTimeZone);
  const local = datePartsInTimeZone(now, timeZone);
  if (local.minutes < scheduledMinutes) return false;

  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('sight:telegram:daily-sales', 0) AS acquired"
    );
    locked = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!locked) return false;

    const [sentRows] = await connection.execute(
      'SELECT `value` FROM app_settings WHERE `key` = ? LIMIT 1',
      ['telegramDailyReportLastSentDate']
    );
    if (String(sentRows?.[0]?.value || '') === local.dateKey) return false;

    const reportDateKey = shiftDateKey(local.dateKey, -1);
    await Promise.all(configuredAgentChatIds.map((chatId) => sendReport(chatId, reportDateKey)));
    await setSetting('telegramDailyReportLastSentDate', local.dateKey, connection);
    return true;
  } finally {
    if (locked) {
      await connection.execute("SELECT RELEASE_LOCK('sight:telegram:daily-sales')").catch(() => {});
    }
    connection.release();
  }
}

async function configureWebhook() {
  const status = getTelegramAgentStatus();
  if (!status.ready) return false;
  const webhookUrl = `${publicBaseUrl}/api/telegram/webhook`;
  await callTelegramBotApi('setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ['message'],
  });
  await callTelegramBotApi('setMyCommands', {
    commands: [
      { command: 'today', description: "Today's sales" },
      { command: 'yesterday', description: "Yesterday's sales" },
      { command: 'report', description: 'Sales for YYYY-MM-DD' },
      { command: 'operations', description: 'Sales and inventory briefing' },
      { command: 'reset', description: 'Clear conversation context' },
      { command: 'help', description: 'Show commands' },
    ],
  });
  return true;
}

export function startTelegramAgent() {
  const status = getTelegramAgentStatus();
  if (!status.enabled) return () => {};
  if (!status.ready) {
    console.warn('[startup] Telegram agent is enabled but its required settings are incomplete.');
    return () => {};
  }

  configureWebhook()
    .then(() => console.log('[startup] Telegram sales agent webhook configured.'))
    .catch((error) => console.error('Failed to configure Telegram sales agent webhook', error));

  const check = () => {
    deliverDailyReportIfDue().catch((error) =>
      console.error('Failed to deliver scheduled Telegram sales report', error)
    );
  };
  check();
  const timer = setInterval(check, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
