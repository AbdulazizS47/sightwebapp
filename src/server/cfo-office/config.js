const DEFAULT_MODEL = 'grok-4';
const DEFAULT_BASE_URL = 'https://api.x.ai/v1';

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function timeList(value) {
  return list(value).filter((item) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(item));
}

export function getCfoOfficeConfig(env = process.env) {
  const enabled = (env.CFO_OFFICE_ENABLED || '').trim().toLowerCase() === 'true';
  const chatId = (env.CFO_OFFICE_CHAT_ID || '').trim();
  const apiKey = (env.XAI_API_KEY || '').trim();
  const model = (env.CFO_OFFICE_MODEL || DEFAULT_MODEL).trim();
  const replyMode = (env.CFO_OFFICE_REPLY_MODE || 'all').trim().toLowerCase() === 'mentions'
    ? 'mentions'
    : 'all';
  const questionsPerRound = Math.min(
    Math.max(Number.parseInt(env.CFO_OFFICE_QUESTIONS_PER_ROUND || '2', 10) || 2, 1),
    5
  );
  return {
    enabled,
    ready: enabled && Boolean(chatId) && Boolean(apiKey) && Boolean(model),
    chatId,
    chatConfigured: Boolean(chatId),
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    baseUrl: (env.XAI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model,
    approverUserIds: list(env.CFO_OFFICE_APPROVER_USER_IDS),
    questionTimes: timeList(env.CFO_OFFICE_QUESTION_TIMES || '10:00,17:00'),
    questionsPerRound,
    replyMode,
    maxAttachmentBytes: 10 * 1024 * 1024,
  };
}

export function publicCfoOfficeStatus(config = getCfoOfficeConfig()) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    chatConfigured: config.chatConfigured,
    apiKeyConfigured: config.apiKeyConfigured,
    model: config.model,
    approverCount: config.approverUserIds.length,
    questionTimes: config.questionTimes,
    replyMode: config.replyMode,
  };
}
