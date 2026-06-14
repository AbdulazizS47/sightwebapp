import 'dotenv/config';

const provider = (
  process.env.ORDER_NOTIFY_PROVIDER ||
  process.env.ORDER_NOTIFICATION_PROVIDER ||
  ''
)
  .trim()
  .toLowerCase();

const telegramBotToken = (
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.ORDER_NOTIFY_TELEGRAM_BOT_TOKEN ||
  ''
).trim();

const telegramChatIds = (
  process.env.TELEGRAM_CHAT_ID ||
  process.env.TELEGRAM_ORDER_CHAT_ID ||
  process.env.ORDER_NOTIFY_TELEGRAM_CHAT_ID ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const telegramApiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(
  /\/+$/,
  ''
);

const notifyTimeoutMs = Math.max(
  Number(process.env.ORDER_NOTIFY_TIMEOUT_MS || 5000) || 5000,
  1000
);

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toFixed(2);
}

function formatQty(value, unit) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return `0 ${unit || ''}`.trim();
  if (unit === 'pcs') return `${Math.round(amount)} ${unit}`.trim();
  return `${amount.toFixed(Number.isInteger(amount) ? 0 : 2)} ${unit || ''}`.trim();
}

function formatPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function formatCustomerName(value) {
  const name = String(value || '').trim();
  return name || '-';
}

function formatOrderItem(item) {
  const quantity = Math.max(1, Number(item?.quantity || 1));
  const name = String(item?.nameEn || item?.name || item?.nameAr || item?.id || 'Item').trim();
  const unitPrice = Number(item?.price || 0);
  const priceText = Number.isFinite(unitPrice) ? ` (${formatMoney(unitPrice)} SAR)` : '';
  return `- ${quantity}x ${name}${priceText}`;
}

function getTelegramNotificationStatus() {
  const telegramConfigured = Boolean(telegramBotToken && telegramChatIds.length > 0);
  const enabled = provider === 'telegram' || (!provider && telegramConfigured);

  return {
    enabled,
    provider: enabled ? 'telegram' : provider || 'disabled',
    telegramConfigured,
    chatCount: telegramChatIds.length,
    missingTelegramBotToken: enabled && !telegramBotToken,
    missingTelegramChatId: enabled && telegramChatIds.length === 0,
  };
}

export function getOrderNotificationStatus() {
  return getTelegramNotificationStatus();
}

export function buildNewOrderMessage(order) {
  const orderNumber = String(order?.orderNumber || order?.id || 'New order');
  const items = Array.isArray(order?.items) ? order.items : [];
  const visibleItems = items.slice(0, 12).map(formatOrderItem);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  const itemLines = visibleItems.length
    ? visibleItems.join('\n')
    : '- No item details available';
  const moreLine = hiddenCount > 0 ? `\n- ...and ${hiddenCount} more` : '';
  const adminUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_ORIGIN || '')
    .trim()
    .replace(/\/+$/, '');

  return [
    `New SIGHT order #${orderNumber}`,
    `Total: ${formatMoney(order?.totalWithVat ?? order?.total)} SAR`,
    `Payment: ${String(order?.paymentMethod || 'cash')}`,
    `Customer: ${formatPhone(order?.phoneNumber)}`,
    `Name: ${formatCustomerName(order?.userName)}`,
    '',
    'Items:',
    `${itemLines}${moreLine}`,
    ...(adminUrl ? ['', `Admin: ${adminUrl}/#/dashboard/live-orders`] : []),
  ].join('\n');
}

export function buildInventoryLowStockMessage(item) {
  const name = String(item?.nameEn || item?.nameAr || item?.id || 'Inventory item').trim();
  const stockQty = formatQty(item?.stockQty, item?.unit);
  const thresholdQty = formatQty(item?.lowStockThreshold, item?.unit);
  const adminUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_ORIGIN || '')
    .trim()
    .replace(/\/+$/, '');

  return [
    `Low stock alert: ${name}`,
    `Current stock: ${stockQty}`,
    `Low stock limit: ${thresholdQty}`,
    `Item ID: ${String(item?.id || '-').trim() || '-'}`,
    ...(adminUrl ? ['', `Admin: ${adminUrl}/#/dashboard/inventory`] : []),
  ].join('\n');
}

async function postTelegramMessage(chatId, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), notifyTimeoutMs);

  try {
    const response = await fetch(
      `${telegramApiBase}/bot${telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Telegram sendMessage failed: HTTP ${response.status} ${body}`);
    }

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendNewOrderNotification(order) {
  const status = getTelegramNotificationStatus();
  if (!status.enabled) return false;
  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (telegramChatIds.length === 0) throw new Error('TELEGRAM_CHAT_ID is not set');

  const message = buildNewOrderMessage(order);
  await Promise.all(telegramChatIds.map((chatId) => postTelegramMessage(chatId, message)));
  return true;
}

export async function sendInventoryLowStockNotification(item) {
  const status = getTelegramNotificationStatus();
  if (!status.enabled) return false;
  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (telegramChatIds.length === 0) throw new Error('TELEGRAM_CHAT_ID is not set');

  const message = buildInventoryLowStockMessage(item);
  await Promise.all(telegramChatIds.map((chatId) => postTelegramMessage(chatId, message)));
  return true;
}
