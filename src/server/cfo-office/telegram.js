import { getDateKeyInTimeZone } from '../operations/date-utils.js';
import { createCfoOfficeAgent } from './agent.js';
import { getCfoOfficeConfig } from './config.js';
import { formatQuestionMessage } from './questions.js';
import {
  attachApprovalMessage,
  findAskedQuestion,
  getOfficeSummary,
  listMembers,
  listPendingRecords,
  listQuestions,
  listRecordsByApprovalMessage,
  markQuestionAsked,
  pickQuestionsToAsk,
  reviewRecord,
  saveAttachment,
  saveMessage,
  seedCfoQuestions,
  upsertMember,
} from './store.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TYPE_LABELS = {
  expense: 'Expense',
  purchase: 'Purchase',
  ingredient_cost: 'Ingredient cost',
  fixed_cost: 'Fixed cost',
  staff: 'Staff',
  salary: 'Salary',
  cash_count: 'Cash count',
  bank_balance: 'Bank balance',
  income_other: 'Other income',
  loan: 'Loan',
  investment: 'Investment',
  supplier: 'Supplier',
  payment_provider: 'Payment provider',
  tax_info: 'Tax info',
  target: 'Target',
  fact: 'Fact',
};

function senderOf(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return {
    id: from?.id != null ? String(from.id) : null,
    name: name || from?.username || 'Unknown',
    username: from?.username || null,
  };
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && value != null ? `${n.toFixed(2)} SAR` : null;
}

export function formatRecordLine(record) {
  const icon = record.status === 'confirmed' ? '✅' : record.status === 'rejected' ? '❌' : '⏳';
  const parts = [
    `${icon} #${record.id} ${TYPE_LABELS[record.recordType] || record.recordType}`,
    money(record.amount),
    record.unitCost != null && record.unit ? `${Number(record.unitCost)} SAR/${record.unit}` : null,
    record.frequency && record.frequency !== 'one_time' ? record.frequency : null,
    record.counterparty || record.staffMemberName || null,
    record.recordDate || null,
  ].filter(Boolean);
  return `${parts.join(' · ')}\n   ${record.description}`;
}

function approvalKeyboard(records) {
  const pending = records.filter((record) => record.status === 'pending');
  const rows = pending.slice(0, 20).map((record) => [
    { text: `✅ Approve #${record.id}`, callback_data: `cfo:a:${record.id}` },
    { text: `❌ Reject #${record.id}`, callback_data: `cfo:r:${record.id}` },
  ]);
  if (pending.length > 1) rows.push([{ text: '✅ Approve all', callback_data: 'cfo:aa' }]);
  return { inline_keyboard: rows };
}

function approvalText(records, submitter) {
  return [
    `Needs owner approval${submitter ? ` (from ${submitter})` : ''} / بانتظار موافقة المالك`,
    '',
    ...records.map(formatRecordLine),
  ].join('\n');
}

function helpText() {
  return [
    'CFO Office / مكتب المدير المالي',
    '',
    'Just talk to me: send numbers, bills, receipts, screenshots or documents and I will record them.',
    'أرسل الأرقام والفواتير والإيصالات والمستندات وسأسجلها.',
    '',
    '/cfo_questions — what I still need to know',
    '/cfo_ask — ask the next questions now',
    '/cfo_pending — records waiting for approval',
    '/cfo_summary — what has been collected so far',
    '/cfo_setup — show this chat id and your user id',
  ].join('\n');
}

function commandOf(text) {
  const first = String(text || '').trim().split(/\s+/)[0] || '';
  if (!first.startsWith('/')) return null;
  return first.toLowerCase().split('@')[0];
}

async function withLock(db, name, fn) {
  if (typeof db.getConnection !== 'function') return fn(db);
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    locked = Number(rows?.[0]?.acquired || 0) === 1;
    if (!locked) return null;
    return await fn(connection);
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    connection.release();
  }
}

export function createCfoOffice({
  db,
  telegram,
  agent,
  config = getCfoOfficeConfig(),
  timeZone = 'Asia/Riyadh',
  now = () => new Date(),
}) {
  const effectiveAgent = agent || (config.ready ? createCfoOfficeAgent({ db, timeZone, now }) : null);
  let botIdentity = null;

  async function getBot() {
    if (!botIdentity) botIdentity = await telegram.call('getMe', {}).catch(() => null);
    return botIdentity;
  }

  async function send(text, { replyTo, keyboard, questionKey } = {}) {
    const result = await telegram.call('sendMessage', {
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    const bot = await getBot();
    await saveMessage(db, {
      chatId: config.chatId,
      telegramMessageId: result?.message_id ?? null,
      direction: 'out',
      fromUserId: bot?.id ?? null,
      fromName: 'CFO',
      messageType: 'text',
      text,
      questionKey,
    }).catch((error) => console.error('Failed to store CFO Office outbound message', error));
    return result;
  }

  async function postApproval(records, submitter) {
    const pending = records.filter((record) => record.status === 'pending');
    if (!pending.length) return null;
    const result = await send(approvalText(pending, submitter), { keyboard: approvalKeyboard(pending) });
    if (result?.message_id != null) {
      await attachApprovalMessage(db, pending.map((record) => record.id), result.message_id);
    }
    return result;
  }

  async function askQuestions(count = config.questionsPerRound) {
    const questions = await pickQuestionsToAsk(db, count, now().getTime());
    if (!questions.length) return 0;
    const members = await listMembers(db);
    const ownerMentions = members
      .filter((m) => m.isApprover && m.username)
      .map((m) => `@${m.username}`)
      .join(' ');
    for (const question of questions) {
      const mention = question.audience === 'owner' ? ownerMentions : '';
      await send(formatQuestionMessage(question, { mention }), { questionKey: question.questionKey });
      await markQuestionAsked(db, question.questionKey, now().getTime());
    }
    return questions.length;
  }

  async function storeAttachment(message, sender) {
    let file = null;
    let kind = null;
    if (Array.isArray(message.photo) && message.photo.length) {
      file = message.photo[message.photo.length - 1];
      kind = 'photo';
      file = { ...file, mime_type: 'image/jpeg' };
    } else if (message.document) {
      file = message.document;
      kind = 'document';
    } else if (message.voice || message.audio) {
      file = message.voice || message.audio;
      kind = message.voice ? 'voice' : 'audio';
    }
    if (!file?.file_id) return null;

    let data = null;
    let note = null;
    if (Number(file.file_size || 0) <= config.maxAttachmentBytes) {
      try {
        ({ data } = await telegram.download(file.file_id, config.maxAttachmentBytes));
      } catch (error) {
        console.error('CFO Office could not download a Telegram file', error);
        note = 'the file could not be downloaded';
      }
    } else {
      note = 'the file is larger than 10 MB and was not downloaded';
    }
    const mimeType = file.mime_type || null;
    const attachmentId = await saveAttachment(db, {
      chatId: config.chatId,
      telegramFileId: file.file_id,
      telegramFileUniqueId: file.file_unique_id,
      kind,
      fileName: file.file_name || null,
      mimeType,
      byteSize: data ? data.length : file.file_size ?? null,
      data,
    });
    const image = data && IMAGE_MIME_TYPES.has(mimeType) ? { mimeType, base64: data.toString('base64') } : null;
    if (!image && !note) {
      note =
        kind === 'document'
          ? `${sender.name} sent a document "${file.file_name || 'file'}" (${mimeType || 'unknown type'}). It is stored, but you cannot read its contents; ask for a photo/screenshot or the key figures.`
          : `${sender.name} sent a ${kind} message. It is stored, but you cannot listen to it; ask them to type the key details.`;
    } else if (note) {
      note = `${sender.name} sent a ${kind}, but ${note}.`;
    }
    return { attachmentId, kind, image, note };
  }

  async function handleCommand(command, message, sender) {
    if (command === '/cfo_help' || command === '/help' || command === '/start') {
      await send(helpText(), { replyTo: message.message_id });
      return true;
    }
    if (command === '/cfo_setup') {
      await send(`Chat id: ${message.chat.id}\nYour user id: ${sender.id}`, { replyTo: message.message_id });
      return true;
    }
    if (command === '/cfo_questions') {
      const open = await listQuestions(db, 'open');
      const answered = await listQuestions(db, 'answered');
      await send(
        [
          `Still need (${open.length}) / ما زلت أحتاج:`,
          ...open.slice(0, 25).map((q) => `• ${q.questionEn}`),
          '',
          `Answered: ${answered.length}`,
        ].join('\n'),
        { replyTo: message.message_id }
      );
      return true;
    }
    if (command === '/cfo_ask') {
      const asked = await askQuestions();
      if (!asked) await send('Nothing new to ask right now. 👍', { replyTo: message.message_id });
      return true;
    }
    if (command === '/cfo_pending') {
      const pending = await listPendingRecords(db, { limit: 20 });
      if (!pending.length) await send('Nothing is waiting for approval.', { replyTo: message.message_id });
      else await postApproval(pending);
      return true;
    }
    if (command === '/cfo_summary') {
      const summary = await getOfficeSummary(db);
      const lines = summary.records.map(
        (row) => `• ${TYPE_LABELS[row.recordType] || row.recordType} (${row.status}): ${row.total}`
      );
      await send(
        [
          'CFO Office summary / ملخص',
          `Questions: ${summary.questions.answered || 0} answered, ${summary.questions.open || 0} open, ${summary.questions.skipped || 0} skipped`,
          `Messages received: ${summary.messagesReceived} (${summary.filesReceived} with files)`,
          '',
          lines.length ? 'Records:' : 'No records yet.',
          ...lines,
        ].join('\n'),
        { replyTo: message.message_id }
      );
      return true;
    }
    return false;
  }

  async function processMessage(message, update) {
    const sender = senderOf(message.from);
    const isApprover = Boolean(sender.id && config.approverUserIds.includes(sender.id));
    await upsertMember(db, {
      userId: sender.id,
      displayName: sender.name,
      username: sender.username,
      isApprover,
    });

    const text = String(message.text ?? message.caption ?? '').trim();
    const attachment = await storeAttachment(message, sender);
    const replyToQuestion = await findAskedQuestion(db, config.chatId, message.reply_to_message?.message_id);
    const sourceMessageId = await saveMessage(db, {
      chatId: config.chatId,
      telegramMessageId: message.message_id,
      direction: 'in',
      fromUserId: sender.id,
      fromName: sender.name,
      messageType: attachment?.kind || 'text',
      text: text || (attachment ? `[${attachment.kind}]` : null),
      attachmentId: attachment?.attachmentId ?? null,
      replyToTelegramMessageId: message.reply_to_message?.message_id ?? null,
      questionKey: replyToQuestion?.questionKey ?? null,
    });
    if (sourceMessageId == null) return { duplicate: true };

    const command = commandOf(text);
    if (command && (await handleCommand(command, message, sender))) return { command };

    if (config.replyMode === 'mentions' && !attachment && !replyToQuestion) {
      const bot = await getBot();
      const mentioned = bot?.username && text.toLowerCase().includes(`@${bot.username.toLowerCase()}`);
      const repliedToBot = bot?.id != null && message.reply_to_message?.from?.id === bot.id;
      if (!mentioned && !repliedToBot) return { skipped: true };
    }
    if (!text && !attachment) return { skipped: true };
    if (!effectiveAgent) return { skipped: true, reason: 'agent_not_configured' };

    await telegram.call('sendChatAction', { chat_id: config.chatId, action: 'typing' }).catch(() => {});
    const result = await effectiveAgent.handle({
      chatId: config.chatId,
      sender,
      isApprover,
      text,
      image: attachment?.image || null,
      attachmentNote: attachment?.note || null,
      replyToQuestion,
      sourceMessageId,
      attachmentId: attachment?.attachmentId ?? null,
      requestId: update?.update_id != null ? String(update.update_id) : null,
    });
    if (result.text) await send(result.text, { replyTo: message.message_id });
    await postApproval(result.savedRecords, sender.name);
    return { replied: Boolean(result.text), saved: result.savedRecords.length };
  }

  async function handleCallback(query) {
    const data = String(query.data || '');
    const messageId = query.message?.message_id;
    const reviewer = senderOf(query.from);
    if (!reviewer.id || !config.approverUserIds.includes(reviewer.id)) {
      await telegram.call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Only the owner can approve. / الموافقة للمالك فقط.',
        show_alert: true,
      });
      return { denied: true };
    }
    const [, action, rawId] = data.split(':');
    let ids = [];
    if (action === 'aa') {
      ids = (await listRecordsByApprovalMessage(db, messageId))
        .filter((record) => record.status === 'pending')
        .map((record) => Number(record.id));
    } else if ((action === 'a' || action === 'r') && /^\d+$/.test(rawId || '')) {
      ids = [Number(rawId)];
    }
    const status = action === 'r' ? 'rejected' : 'confirmed';
    let changed = 0;
    for (const id of ids) {
      if (await reviewRecord(db, id, { status, reviewerId: reviewer.id, reviewerName: reviewer.name })) changed += 1;
    }
    await telegram.call('answerCallbackQuery', {
      callback_query_id: query.id,
      text: changed ? `${status === 'confirmed' ? 'Approved' : 'Rejected'} ${changed}` : 'Already handled',
    });
    if (messageId != null) {
      const records = await listRecordsByApprovalMessage(db, messageId);
      if (records.length) {
        await telegram
          .call('editMessageText', {
            chat_id: config.chatId,
            message_id: messageId,
            text: approvalText(records),
            reply_markup: approvalKeyboard(records),
          })
          .catch((error) => console.error('Failed to update CFO approval message', error));
      }
    }
    return { changed };
  }

  // Returns { handled } synchronously-fast; slow work (Grok, downloads) runs in `work`.
  function handleUpdate(update) {
    if (!config.enabled) return { handled: false };
    const query = update?.callback_query;
    if (query && String(query.data || '').startsWith('cfo:')) {
      if (String(query.message?.chat?.id) !== config.chatId) return { handled: true };
      return { handled: true, work: handleCallback(query) };
    }
    const message = update?.message;
    if (!message?.chat) return { handled: false };
    const chatId = String(message.chat.id);
    if (chatId !== config.chatId) {
      if (commandOf(message.text) === '/cfo_setup') {
        const sender = senderOf(message.from);
        return {
          handled: true,
          work: telegram.call('sendMessage', {
            chat_id: chatId,
            text: `Chat id: ${chatId}\nYour user id: ${sender.id}\n\nPut the chat id in CFO_OFFICE_CHAT_ID and approver user ids in CFO_OFFICE_APPROVER_USER_IDS.`,
          }),
        };
      }
      return { handled: false };
    }
    if (message.migrate_to_chat_id) {
      console.warn(
        `[cfo-office] The CFO Office group became a supergroup. Update CFO_OFFICE_CHAT_ID to ${message.migrate_to_chat_id}.`
      );
      return { handled: true };
    }
    if (message.from?.is_bot) return { handled: true };
    return {
      handled: true,
      work: processMessage(message, update).catch(async (error) => {
        await telegram
          .call('sendMessage', {
            chat_id: config.chatId,
            text: 'I could not process that message. Please try again. / لم أستطع معالجة الرسالة، حاول مرة أخرى.',
            reply_to_message_id: message.message_id,
            allow_sending_without_reply: true,
          })
          .catch(() => {});
        throw error;
      }),
    };
  }

  async function runSchedule(date = now()) {
    if (!config.ready || !config.questionTimes.length) return 0;
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const minutes =
      Number(local.find((part) => part.type === 'hour')?.value) * 60 +
      Number(local.find((part) => part.type === 'minute')?.value);
    const todayKey = getDateKeyInTimeZone(date, timeZone);
    const due = config.questionTimes.filter((time) => {
      const [h, m] = time.split(':').map(Number);
      return minutes >= h * 60 + m;
    });
    if (!due.length) return 0;
    // Mark every due slot for today, but ask only one round even if several slots were missed.
    const asked = await withLock(db, 'sight:cfo-office:questions', async (conn) => {
      let pending = false;
      for (const time of due) {
        const key = `cfoOfficeQuestionSlot:${time}`;
        const [rows] = await conn.execute('SELECT `value` FROM app_settings WHERE `key` = ? LIMIT 1', [key]);
        if (String(rows?.[0]?.value || '') === todayKey) continue;
        pending = true;
        await conn.execute(
          `INSERT INTO app_settings (\`key\`, \`value\`, updatedAt) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updatedAt = VALUES(updatedAt)`,
          [key, todayKey, Date.now()]
        );
      }
      return pending ? askQuestions() : 0;
    });
    return Number(asked || 0);
  }

  async function init() {
    await seedCfoQuestions(db);
  }

  return { handleUpdate, runSchedule, askQuestions, init };
}
