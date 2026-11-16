const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function time(value, fallback) {
  const raw = String(value ?? fallback).trim();
  if (!raw) return null;
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw) ? raw.padStart(5, '0') : fallback;
}

export function getCmoOfficeConfig(env = process.env) {
  const enabled = (env.CMO_OFFICE_ENABLED || '').trim().toLowerCase() === 'true';
  const chatId = (env.CMO_OFFICE_CHAT_ID || '').trim();
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  const model = (env.CMO_OFFICE_MODEL || DEFAULT_MODEL).trim();
  const effort = EFFORTS.includes((env.CMO_OFFICE_EFFORT || '').trim()) ? env.CMO_OFFICE_EFFORT.trim() : 'medium';
  const approvers = list(env.CMO_OFFICE_APPROVER_USER_IDS || env.CFO_OFFICE_APPROVER_USER_IDS);
  const weeklyDay = DAYS.indexOf((env.CMO_OFFICE_WEEKLY_DAY || 'sat').trim().toLowerCase().slice(0, 3));
  return {
    enabled,
    ready: enabled && Boolean(chatId) && Boolean(apiKey) && Boolean(model),
    chatId,
    chatConfigured: Boolean(chatId),
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    model,
    effort,
    approverUserIds: approvers,
    // Daily post draft before the 3 PM post; empty string disables it.
    dailyDraftTime: time(env.CMO_OFFICE_DAILY_TIME, '14:00'),
    weeklyDay: weeklyDay >= 0 ? weeklyDay : 6,
    weeklyTime: time(env.CMO_OFFICE_WEEKLY_TIME, '13:00'),
    replyMode: (env.CMO_OFFICE_REPLY_MODE || 'all').trim().toLowerCase() === 'mentions' ? 'mentions' : 'all',
    // Telegram bots can download files up to 20 MB.
    maxAttachmentBytes: 20 * 1024 * 1024,
  };
}

export function publicCmoOfficeStatus(config = getCmoOfficeConfig()) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    chatConfigured: config.chatConfigured,
    apiKeyConfigured: config.apiKeyConfigured,
    model: config.model,
    effort: config.effort,
    approverCount: config.approverUserIds.length,
    dailyDraftTime: config.dailyDraftTime,
    weeklyDay: config.weeklyDay,
    weeklyTime: config.weeklyTime,
    replyMode: config.replyMode,
  };
}
