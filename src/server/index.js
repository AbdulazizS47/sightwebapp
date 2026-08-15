import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, initSchema, ensureDatabase } from './db.js';
import { sendOtpSms, sendWhatsAppMarketingMessage, WHATSAPP_MARKETING_CONFIGURED } from './sms.js';
import {
  getLoyaltyCycleStamps,
  selectFreeCoffeeReward,
  shouldAccrueLoyaltyPoint,
} from './loyalty.js';
import {
  getOrderNotificationStatus,
  sendInventoryLowStockNotification,
  sendNewOrderNotification,
} from './notifications.js';
import {
  getTelegramAgentStatus,
  handleTelegramUpdate,
  startTelegramAgent,
} from './telegram-agent.js';

const app = new Hono();
const printApi = new Hono();
const NODE_ENV = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const ORDER_FINALIZATION_LOCK_NAME = 'sight:orders:finalize';

app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = EFFECTIVE_CORS_ORIGINS;
      if (!allowed.length) return undefined;
      if (!origin) return undefined;
      return allowed.includes(origin) ? origin : undefined;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Session-Token',
      'x-admin-token',
      'X-Device-Key',
    ],
  })
);
app.use('*', logger());

const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const ADMIN_PHONE = process.env.ADMIN_PHONE || '0547444145';
// The one admin account that can never be deactivated or have its privileges managed away by
// another admin — computed early since normalizeKsaPhone() is a hoisted function declaration.
const ADMIN_PHONE_NORMALIZED = normalizeKsaPhone(ADMIN_PHONE);
const OTP_DEV_MODE_CONFIGURED = (process.env.OTP_DEV_MODE || '').trim() === 'true';
const OTP_DEV_MODE = OTP_DEV_MODE_CONFIGURED && !IS_PRODUCTION;
const OTP_DEBUG_RETURN_CODE_CONFIGURED =
  (process.env.OTP_DEBUG_RETURN_CODE || '').trim() === 'true';
const OTP_DEBUG_RETURN_CODE = OTP_DEBUG_RETURN_CODE_CONFIGURED && !IS_PRODUCTION;
const ALLOW_SEED_MENU_TOOLS =
  ((process.env.ALLOW_SEED_MENU_TOOLS || process.env.ALLOW_DEMO_MENU_TOOLS || '')
    .trim()
    .toLowerCase() === 'true');
const FIXED_TABLET_DEVICE_KEY = '10c455da1e66cbea75db336e916786818b666c9e13323668';
const PRINT_DEVICE_KEYS = (process.env.PRINT_DEVICE_KEY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OTP_TTL_MS = Math.max(
  Number(process.env.OTP_TTL_MS || 5 * 60 * 1000) || 5 * 60 * 1000,
  60 * 1000
);
const OTP_RESEND_MIN_MS = Math.max(
  Number(process.env.OTP_RESEND_MIN_MS || 60 * 1000) || 60 * 1000,
  10 * 1000
);
const OTP_MAX_PER_HOUR = Math.max(Number(process.env.OTP_MAX_PER_HOUR || 5) || 5, 1);
const OTP_MAX_ATTEMPTS = Math.max(Number(process.env.OTP_MAX_ATTEMPTS || 5) || 5, 1);
const OTP_PEPPER = (process.env.OTP_PEPPER || 'dev-pepper-change-me').trim();
const SMS_PROVIDER = (process.env.SMS_PROVIDER || 'console').trim().toLowerCase();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.UPLOADS_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const DEFAULT_OPEN_STATUS = (process.env.OPEN_STATUS_DEFAULT || 'true').trim().toLowerCase() !== 'false';
const DEFAULT_HOURS_EN = (process.env.DEFAULT_HOURS_EN || 'Daily: 4:00 PM - 2:00 AM').trim();
const DEFAULT_HOURS_AR =
  (process.env.DEFAULT_HOURS_AR || 'يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا').trim();
const DEFAULT_HOURS_START = (process.env.DEFAULT_HOURS_START || '16:00').trim();
const DEFAULT_HOURS_END = (process.env.DEFAULT_HOURS_END || '02:00').trim();
const DEFAULT_TIMEZONE = (process.env.DEFAULT_TIMEZONE || 'Asia/Riyadh').trim();
const DEFAULT_SCHEDULE_ENABLED =
  (process.env.DEFAULT_SCHEDULE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const PRINT_JOB_STALE_MS = Math.max(
  Number(process.env.PRINT_JOB_STALE_MS || 2 * 60 * 1000) || 2 * 60 * 1000,
  30 * 1000
);
const PRINT_JOB_RETRY_FAILED_MS = Math.max(
  Number(process.env.PRINT_JOB_RETRY_FAILED_MS || 60 * 1000) || 60 * 1000,
  10 * 1000
);
const PRINT_JOB_MAX_ATTEMPTS = Math.max(
  Number(process.env.PRINT_JOB_MAX_ATTEMPTS || 10) || 10,
  1
);
const PRINT_JOB_BACKFILL_MS = Math.max(
  Number(process.env.PRINT_JOB_BACKFILL_MS || 24 * 60 * 60 * 1000) ||
    24 * 60 * 60 * 1000,
  0
);
const HEALTHCHECK_DB = (process.env.HEALTHCHECK_DB || 'true').trim().toLowerCase() !== 'false';
const HEALTHCHECK_STRICT =
  (process.env.HEALTHCHECK_STRICT || '').trim().toLowerCase() === 'true';
const SESSION_TTL_MS = Math.max(
  Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000) || 30 * 24 * 60 * 60 * 1000,
  60 * 60 * 1000
);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const DEFAULT_PROD_CORS_ORIGINS = [
  'https://sightcoffeespace.com',
  'https://www.sightcoffeespace.com',
];
const EFFECTIVE_CORS_ORIGINS = (() => {
  const configured = new Set(CORS_ORIGINS);
  if (!IS_PRODUCTION) {
    for (const origin of DEFAULT_DEV_CORS_ORIGINS) configured.add(origin);
  } else {
    for (const origin of DEFAULT_PROD_CORS_ORIGINS) configured.add(origin);
  }
  if (PUBLIC_BASE_URL) {
    try {
      configured.add(new URL(PUBLIC_BASE_URL).origin);
    } catch {
      // ignore invalid PUBLIC_BASE_URL here; request handling will fall back safely
    }
  }
  return Array.from(configured);
})();
const EXT_TO_IMAGE_CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};
const UPLOAD_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_UPLOAD_IMAGE_BYTES = 1024 * 1024;
const ORDER_VAT_RATE = 0.15;
const LOYALTY_REWARD_CYCLE = 5;
const LOYALTY_FREE_CUP_VALUE_SAR = Math.max(
  Number(process.env.LOYALTY_FREE_CUP_VALUE_SAR || 9) || 9,
  0
);
const BUILD_DIR = path.join(process.cwd(), 'build');
// In-memory cache of sessions (persistent store is MySQL)
const sessions = new Map();

const logStartupWarning = (message) => {
  console.warn(`[startup] ${message}`);
};

function isStrongSharedSecret(value) {
  return String(value || '').trim().length >= 16;
}

const ADMIN_TOKEN_ENABLED = ADMIN_TOKEN && isStrongSharedSecret(ADMIN_TOKEN);
const ACCEPTED_PRINT_DEVICE_KEYS = Array.from(
  new Set([...PRINT_DEVICE_KEYS, FIXED_TABLET_DEVICE_KEY].filter(isStrongSharedSecret))
);
const PRINT_DEVICE_KEY_ENABLED = ACCEPTED_PRINT_DEVICE_KEYS.length > 0;

if (ADMIN_TOKEN && !ADMIN_TOKEN_ENABLED) {
  logStartupWarning('ADMIN_TOKEN is set but too short; header-based admin fallback has been disabled.');
}
if (!PRINT_DEVICE_KEYS.length) {
  logStartupWarning('PRINT_DEVICE_KEY is not set; print bridge will not be able to claim jobs.');
}
if (PRINT_DEVICE_KEYS.length > 0 && !PRINT_DEVICE_KEYS.some(isStrongSharedSecret)) {
  logStartupWarning('PRINT_DEVICE_KEY is too short; print bridge authentication has been disabled.');
}
if (OTP_DEV_MODE_CONFIGURED && IS_PRODUCTION) {
  logStartupWarning('OTP_DEV_MODE was requested but has been disabled because NODE_ENV=production.');
}
if (OTP_DEBUG_RETURN_CODE_CONFIGURED && IS_PRODUCTION) {
  logStartupWarning(
    'OTP_DEBUG_RETURN_CODE was requested but has been disabled because NODE_ENV=production.'
  );
}
if (SMS_PROVIDER === 'console' && !OTP_DEV_MODE) {
  logStartupWarning('SMS_PROVIDER is "console"; OTPs will be logged to stdout.');
}
const ORDER_NOTIFICATION_STATUS = getOrderNotificationStatus();
if (!ORDER_NOTIFICATION_STATUS.enabled) {
  logStartupWarning(
    'Order notifications are disabled; set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable Telegram alerts.'
  );
} else if (!ORDER_NOTIFICATION_STATUS.telegramConfigured) {
  logStartupWarning('Order notifications are enabled but Telegram bot token or chat id is missing.');
} else {
  console.log(
    `[startup] Telegram order notifications enabled for ${ORDER_NOTIFICATION_STATUS.chatCount} chat(s).`
  );
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(`session:${token}`).digest('hex');
}

function getSessionTokenLookupValues(token) {
  const raw = String(token || '').trim();
  if (!raw) return [];
  const hashed = hashSessionToken(raw);
  return hashed === raw ? [raw] : [hashed, raw];
}

async function deleteSessionRecord(token) {
  const values = getSessionTokenLookupValues(token);
  if (!values.length) return;
  const placeholders = values.map(() => '?').join(',');
  await pool.execute(`DELETE FROM sessions WHERE token IN (${placeholders})`, values);
}

async function touchSessionRecord(token, lastSeenAt, expiresAt = null) {
  const values = getSessionTokenLookupValues(token);
  if (!values.length) return;
  const placeholders = values.map(() => '?').join(',');
  if (expiresAt == null) {
    await pool.execute(
      `UPDATE sessions SET lastSeenAt = ? WHERE token IN (${placeholders})`,
      [lastSeenAt, ...values]
    );
    return;
  }
  await pool.execute(
    `UPDATE sessions SET lastSeenAt = ?, expiresAt = ? WHERE token IN (${placeholders})`,
    [lastSeenAt, expiresAt, ...values]
  );
}

async function getSessionUser(token) {
  if (!token) return null;
  const cached = sessions.get(token);
  const now = Date.now();
  if (cached) {
    if (cached.expiresAt && cached.expiresAt <= now) {
      sessions.delete(token);
      try {
        await deleteSessionRecord(token);
      } catch {
        // ignore cleanup failure for expired sessions
      }
      return null;
    }
    return cached.user;
  }
  try {
    const lookupValues = getSessionTokenLookupValues(token);
    if (!lookupValues.length) return null;
    const placeholders = lookupValues.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `
      SELECT u.id, u.phoneNumber, u.name, u.role, u.active, s.expiresAt
      FROM sessions s
      JOIN users u ON u.id = s.userId
      WHERE s.token IN (${placeholders})
      LIMIT 1
    `,
      lookupValues
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return null;
    const expiresAt = row.expiresAt != null ? Number(row.expiresAt) : null;
    if (expiresAt != null && expiresAt <= now) {
      try {
        await deleteSessionRecord(token);
      } catch {
        // ignore cleanup failure for expired sessions
      }
      return null;
    }
    const user = {
      id: String(row.id),
      phoneNumber: String(row.phoneNumber),
      name: String(row.name),
      role: String(row.role),
      active: row.active == null ? true : Boolean(Number(row.active)),
      isRootAdmin: String(row.phoneNumber) === ADMIN_PHONE_NORMALIZED,
    };
    const effectiveExpiresAt = expiresAt ?? now + SESSION_TTL_MS;
    sessions.set(token, { user, expiresAt: effectiveExpiresAt });
    // best-effort keep-alive
    await touchSessionRecord(token, now, effectiveExpiresAt);
    return user;
  } catch (e) {
    console.error('Failed to load session from DB', e);
    return null;
  }
}

function parseTimeToMinutes(raw) {
  const cleaned = String(raw || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(cleaned);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getMinutesInTimeZone(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function getLocalDateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function getDateKeyInTimeZone(date, timeZone) {
  const tz = String(timeZone || '').trim() || DEFAULT_TIMEZONE;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) return getLocalDateKey(date);
    return `${year}${month}${day}`;
  } catch {
    return getLocalDateKey(date);
  }
}

async function getCurrentDateKey() {
  const timeZone = await getSetting('timeZone', DEFAULT_TIMEZONE);
  return getDateKeyInTimeZone(new Date(), timeZone || DEFAULT_TIMEZONE);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeDiscountCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function createHttpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

async function loadCanonicalOrderItems(items, effectiveLanguage, db = pool) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((it) => {
      const quantity = Math.max(1, Math.min(99, Math.floor(Number(it?.quantity) || 1)));
      const id = String(it?.id || '').trim();
      const temperature = ['hot', 'iced'].includes(String(it?.options?.temperature || ''))
        ? String(it.options.temperature)
        : null;
      return { id, quantity, options: temperature ? { temperature } : undefined };
    })
    .filter((it) => it.id);

  if (normalizedItems.length === 0) {
    throw createHttpError(400, 'Invalid items payload');
  }

  const ids = Array.from(new Set(normalizedItems.map((it) => it.id)));
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT
       i.id,
       i.nameEn,
       i.nameAr,
       i.price,
       i.available,
       i.category,
       c.nameEn AS categoryNameEn,
       c.nameAr AS categoryNameAr
     FROM items i
     LEFT JOIN categories c ON c.id = i.category
     WHERE i.id IN (${placeholders})`,
    ids
  );
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw createHttpError(400, 'Some items were not found', { missing });
  }
  const unavailable = ids.filter((id) => {
    const row = byId.get(id);
    return row && Number(row.available) === 0;
  });
  if (unavailable.length > 0) {
    throw createHttpError(400, 'Some items are unavailable', { unavailable });
  }

  const canonicalItems = normalizedItems.map((it) => {
    const row = byId.get(it.id);
    const price = Number(row?.price || 0);
    const nameEn = String(row?.nameEn || '');
    const nameAr = String(row?.nameAr || '');
    const temperature = it.options?.temperature;
    const temperatureEn = temperature === 'hot' ? 'Hot' : temperature === 'iced' ? 'Iced' : '';
    const temperatureAr = temperature === 'hot' ? 'ساخن' : temperature === 'iced' ? 'بارد' : '';
    const displayNameEn = `${nameEn}${temperatureEn ? ` · ${temperatureEn}` : ''}`;
    const displayNameAr = `${nameAr}${temperatureAr ? ` · ${temperatureAr}` : ''}`;
    const name =
      effectiveLanguage === 'ar' ? displayNameAr || displayNameEn : displayNameEn || displayNameAr;
    return {
      id: it.id,
      name,
      nameEn: displayNameEn,
      nameAr: displayNameAr,
      price: Number.isFinite(price) ? price : 0,
      quantity: it.quantity,
      category: String(row?.category || ''),
      categoryNameEn: String(row?.categoryNameEn || ''),
      categoryNameAr: String(row?.categoryNameAr || ''),
      ...(it.options ? { options: it.options } : {}),
    };
  });

  return {
    normalizedItems,
    ids,
    placeholders,
    canonicalItems,
  };
}

async function getDiscountCodeRecord(code, db = pool) {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) return null;
  const [rows] = await db.execute('SELECT * FROM discount_codes WHERE code = ? LIMIT 1', [
    normalizedCode,
  ]);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function resolveDiscountCodeUsageGroup(codeRow, fallbackCode) {
  const requestedCode = normalizeDiscountCode(fallbackCode);
  const configuredGroup = normalizeDiscountCode(codeRow?.usageGroup || '');
  return configuredGroup || requestedCode || null;
}

async function getDiscountCodeUsageScope(codeRow, fallbackCode, db = pool) {
  const usageGroup = resolveDiscountCodeUsageGroup(codeRow, fallbackCode);
  if (!usageGroup) {
    return { usageGroup: null, aliasCodes: [] };
  }

  if (!normalizeDiscountCode(codeRow?.usageGroup || '')) {
    return { usageGroup, aliasCodes: [usageGroup] };
  }

  const [rows] = await db.execute('SELECT code FROM discount_codes WHERE usageGroup = ?', [usageGroup]);
  const aliasCodes = Array.isArray(rows)
    ? rows
        .map((row) => normalizeDiscountCode(row?.code || ''))
        .filter(Boolean)
    : [];

  return {
    usageGroup,
    aliasCodes: aliasCodes.length ? Array.from(new Set(aliasCodes)) : [usageGroup],
  };
}

async function getDiscountCodeUsage(codeRow, fallbackCode, userId, db = pool) {
  const { usageGroup, aliasCodes } = await getDiscountCodeUsageScope(codeRow, fallbackCode, db);
  if (!usageGroup) return { usageGroup: null, totalUses: 0, userUses: 0 };

  const placeholders = aliasCodes.map(() => '?').join(',');
  const totalParams = [usageGroup, ...aliasCodes];
  const [totalRows] = await db.execute(
    `SELECT COUNT(*) AS totalUses
     FROM orders
     WHERE discountCodeGroup = ?
        OR (discountCodeGroup IS NULL AND discountCode IN (${placeholders}))`,
    totalParams
  );
  const totalUses = Number(totalRows?.[0]?.totalUses || 0);
  if (!userId) {
    return { usageGroup, totalUses, userUses: 0 };
  }

  const [userRows] = await db.execute(
    `SELECT COUNT(*) AS userUses
     FROM orders
     WHERE userId = ?
       AND (
         discountCodeGroup = ?
         OR (discountCodeGroup IS NULL AND discountCode IN (${placeholders}))
       )`,
    [userId, usageGroup, ...aliasCodes]
  );
  return {
    usageGroup,
    totalUses,
    userUses: Number(userRows?.[0]?.userUses || 0),
  };
}

async function buildOrderPricing({
  canonicalItems,
  effectiveUserId,
  effectiveLanguage,
  redeemReward,
  discountCode,
  db = pool,
  strictDiscountCode = false,
}) {
  const computeTotal = (arr) =>
    roundMoney(
      arr.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0)
    );

  const itemsTotal = computeTotal(canonicalItems);
  let effectiveItems = canonicalItems.map((item) => ({ ...item }));
  let effectiveTotal = itemsTotal;
  let rewardType = null;
  let rewardDiscountAmount = 0;
  let rewardItemId = null;
  let rewardItemName = null;
  // Whether a free-coffee reward is sitting ready on this account, independent of whether the
  // customer actually chose to redeem it this order — createOrderInternal uses this to decide
  // whether to accrue a new stamp (an earned-but-unused reward must not be silently lost).
  let loyaltyRewardAvailable = false;

  if (effectiveUserId) {
    const [rows] = await db.execute(
      'SELECT points FROM loyalty_accounts WHERE userId = ? AND enabled = 1',
      [effectiveUserId]
    );
    const points = Number(rows?.[0]?.points || 0);
    const stamps = getLoyaltyCycleStamps(points, LOYALTY_REWARD_CYCLE);
    loyaltyRewardAvailable = stamps === LOYALTY_REWARD_CYCLE;
    rewardType = loyaltyRewardAvailable && redeemReward ? 'free' : null;

    if (rewardType === 'free') {
      const selectedReward = selectFreeCoffeeReward(
        effectiveItems,
        LOYALTY_FREE_CUP_VALUE_SAR
      );
      const discount = roundMoney(
        Math.min(Number(selectedReward?.unitPrice || 0), effectiveTotal)
      );
      if (discount > 0) {
        const selectedItem = selectedReward.item;
        rewardItemId = String(selectedItem.id || '');
        rewardItemName =
          effectiveLanguage === 'ar'
            ? String(selectedItem.nameAr || selectedItem.name || selectedItem.nameEn || '')
            : String(selectedItem.nameEn || selectedItem.name || selectedItem.nameAr || '');
        rewardDiscountAmount = discount;
        effectiveItems = [
          ...effectiveItems,
          {
            id: 'reward-discount',
            name:
              effectiveLanguage === 'ar'
                ? `كوب قهوة مجاني: ${rewardItemName}`
                : `Free coffee: ${rewardItemName}`,
            nameEn: `Free coffee: ${String(selectedItem.nameEn || selectedItem.name || '')}`,
            nameAr: `كوب قهوة مجاني: ${String(selectedItem.nameAr || selectedItem.name || '')}`,
            price: -discount,
            quantity: 1,
          },
        ];
        effectiveTotal = roundMoney(Math.max(0, effectiveTotal - discount));
      }
    }
  }

  const discountCodeRequested = normalizeDiscountCode(discountCode);
  let discountCodeApplied = false;
  let appliedDiscountCode = null;
  let appliedDiscountName = null;
  let appliedDiscountGroup = null;
  let discountCodeAmount = 0;
  let discountCodeError = null;

  if (discountCodeRequested) {
    const codeRow = await getDiscountCodeRecord(discountCodeRequested, db);
    const failDiscountCode = (message) => {
      if (strictDiscountCode) {
        throw createHttpError(400, message, { discountCode: discountCodeRequested });
      }
      discountCodeError = message;
    };

    if (!codeRow) {
      failDiscountCode('Discount code was not found');
    } else if (Number(codeRow.active) === 0) {
      failDiscountCode('Discount code is inactive');
    } else if (codeRow.startsAt != null && Number(codeRow.startsAt) > Date.now()) {
      failDiscountCode('Discount code is not active yet');
    } else if (codeRow.endsAt != null && Number(codeRow.endsAt) < Date.now()) {
      failDiscountCode('Discount code has expired');
    } else if (rewardDiscountAmount > 0 && Number(codeRow.combinableWithLoyalty) === 0) {
      failDiscountCode('Discount code cannot be combined with loyalty rewards');
    } else if (itemsTotal < roundMoney(codeRow.minSubtotal)) {
      failDiscountCode(
        `Minimum order for this code is ${roundMoney(codeRow.minSubtotal).toFixed(2)} SAR`
      );
    } else {
      const usageLimitTotal =
        codeRow.usageLimitTotal != null ? Number(codeRow.usageLimitTotal) : null;
      const usageLimitPerUser =
        codeRow.usageLimitPerUser != null ? Number(codeRow.usageLimitPerUser) : null;

      if (usageLimitPerUser != null && !effectiveUserId) {
        failDiscountCode('Sign in is required to use this discount code');
      } else {
        const usage = await getDiscountCodeUsage(
          codeRow,
          discountCodeRequested,
          effectiveUserId,
          db
        );
        if (usageLimitTotal != null && usage.totalUses >= usageLimitTotal) {
          failDiscountCode('Discount code usage limit has been reached');
        } else if (usageLimitPerUser != null && usage.userUses >= usageLimitPerUser) {
          failDiscountCode('You have already used this discount code');
        } else {
          const codeType = String(codeRow.type || '').trim().toLowerCase();
          const rawValue = Number(codeRow.value || 0);
          const maxDiscount =
            codeRow.maxDiscount != null ? roundMoney(codeRow.maxDiscount) : null;
          let rawDiscount =
            codeType === 'percent' ? effectiveTotal * (rawValue / 100) : roundMoney(rawValue);
          if (!Number.isFinite(rawDiscount) || rawDiscount <= 0) {
            rawDiscount = 0;
          }
          if (maxDiscount != null) {
            rawDiscount = Math.min(rawDiscount, maxDiscount);
          }
          const effectiveDiscount = roundMoney(Math.min(rawDiscount, effectiveTotal));

          if (effectiveDiscount <= 0) {
            failDiscountCode('Discount code is not eligible for this order');
          } else {
            discountCodeApplied = true;
            appliedDiscountCode = discountCodeRequested;
            appliedDiscountName = String(codeRow.name || discountCodeRequested);
            appliedDiscountGroup = usage.usageGroup;
            discountCodeAmount = effectiveDiscount;
            effectiveItems = [
              ...effectiveItems,
              {
                id: 'discount-code',
                name:
                  effectiveLanguage === 'ar'
                    ? `خصم (${discountCodeRequested})`
                    : `Discount (${discountCodeRequested})`,
                price: -effectiveDiscount,
                quantity: 1,
              },
            ];
            effectiveTotal = roundMoney(Math.max(0, effectiveTotal - effectiveDiscount));
          }
        }
      }
    }
  }

  const vatAmount = roundMoney(effectiveTotal * (ORDER_VAT_RATE / (1 + ORDER_VAT_RATE)));
  const subtotalExclVat = roundMoney(effectiveTotal - vatAmount);

  return {
    itemsTotal,
    rewardType,
    rewardApplied: rewardDiscountAmount > 0,
    rewardDiscountAmount,
    loyaltyRewardAvailable,
    rewardItemId,
    rewardItemName,
    discountCodeRequested: discountCodeRequested || null,
    discountCodeApplied,
    discountCode: appliedDiscountCode,
    discountCodeName: appliedDiscountName,
    discountCodeGroup: appliedDiscountGroup,
    discountCodeAmount,
    discountCodeError,
    effectiveItems,
    total: effectiveTotal,
    subtotalExclVat,
    vatAmount,
    totalWithVat: effectiveTotal,
  };
}

function isOpenForSchedule(now, start, end, timeZone) {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  const nowMin = getMinutesInTimeZone(now, timeZone);
  if (startMin == null || endMin == null || nowMin == null) return null;
  if (startMin === endMin) return true;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

// Single source of truth for "is the shop currently open", shared by the public
// settings endpoint and the customer checkout guard below.
async function getEffectiveOpenStatus() {
  const openRaw = await getSetting('openStatus', DEFAULT_OPEN_STATUS ? 'true' : 'false');
  const hoursEn = await getSetting('hoursEn', DEFAULT_HOURS_EN);
  const hoursAr = await getSetting('hoursAr', DEFAULT_HOURS_AR);
  const scheduleEnabledRaw = await getSetting(
    'scheduleEnabled',
    DEFAULT_SCHEDULE_ENABLED ? 'true' : 'false'
  );
  const hoursStart = await getSetting('hoursStart', DEFAULT_HOURS_START);
  const hoursEnd = await getSetting('hoursEnd', DEFAULT_HOURS_END);
  const timeZone = await getSetting('timeZone', DEFAULT_TIMEZONE);
  const manualOpen = String(openRaw).trim().toLowerCase() === 'true';
  const scheduleEnabled = String(scheduleEnabledRaw).trim().toLowerCase() === 'true';
  const computedOpen = scheduleEnabled
    ? isOpenForSchedule(new Date(), hoursStart, hoursEnd, timeZone)
    : manualOpen;
  const isOpen = typeof computedOpen === 'boolean' ? computedOpen : manualOpen;

  return {
    isOpen,
    manualOpen,
    schedule: {
      enabled: scheduleEnabled,
      start: hoursStart || DEFAULT_HOURS_START,
      end: hoursEnd || DEFAULT_HOURS_END,
      timeZone: timeZone || DEFAULT_TIMEZONE,
    },
    hours: {
      en: hoursEn || DEFAULT_HOURS_EN,
      ar: hoursAr || DEFAULT_HOURS_AR,
    },
  };
}

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

function normalizePublicHttpUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const isLocalHost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname.endsWith('.local');
    if (url.protocol === 'http:' && (IS_PRODUCTION || !isLocalHost)) {
      url.protocol = 'https:';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureUploadsDir() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create uploads dir', e);
  }
}

async function backfillLocalUploads() {
  try {
    const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;

      const safeName = path.basename(entry.name);
      const contentType = EXT_TO_IMAGE_CONTENT_TYPE[path.extname(safeName).toLowerCase()];
      if (!contentType?.startsWith('image/')) continue;

      const data = await fs.readFile(path.join(UPLOADS_DIR, safeName));
      await pool.execute(
        `INSERT IGNORE INTO uploaded_images
         (filename, contentType, data, byteSize, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        [safeName, contentType, data, data.length, Date.now()]
      );
    }
  } catch (error) {
    console.error('Failed to backfill local uploads into persistent storage', error);
  }
}

async function migrateLegacyItemImages() {
  try {
    const [items] = await pool.execute(
      `SELECT id, imageUrl FROM items
       WHERE imageUrl IS NOT NULL AND imageUrl <> ''`
    );
    let migrated = 0;
    const stillMissing = [];

    await Promise.all(
      items.map(async (item) => {
        const rawUrl = String(item.imageUrl || '').trim();
        if (!rawUrl) return;

        let sourceUrl;
        let safeName;
        try {
          const parsed = new URL(rawUrl);
          if (!parsed.pathname.startsWith('/uploads/')) return;
          safeName = path.basename(parsed.pathname);
          if (!safeName) return;
          sourceUrl = normalizePublicHttpUrl(parsed.toString());
        } catch {
          return;
        }

        const [existingRows] = await pool.execute(
          'SELECT filename FROM uploaded_images WHERE filename = ? LIMIT 1',
          [safeName]
        );
        if (existingRows?.length) return;

        // Best-effort recovery: fetch whatever is still reachable at the stored URL
        // (typically another still-running instance's ephemeral disk cache) so it can be
        // written into persistent storage before that copy disappears too. Once no running
        // instance has the file anymore, this permanently cannot recover it and the item
        // needs a manual re-upload — logged clearly below instead of failing silently.
        try {
          const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: 'image/*' } }, 8000);
          if (!response.ok) {
            stillMissing.push({ itemId: item.id, filename: safeName, reason: `HTTP ${response.status}` });
            return;
          }

          const contentType = String(response.headers.get('content-type') || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
          if (!contentType.startsWith('image/')) {
            stillMissing.push({
              itemId: item.id,
              filename: safeName,
              reason: `unexpected content-type "${contentType || 'unknown'}"`,
            });
            return;
          }

          const data = Buffer.from(await response.arrayBuffer());
          if (!data.length || data.length > 5 * 1024 * 1024) {
            stillMissing.push({ itemId: item.id, filename: safeName, reason: 'empty or oversized response' });
            return;
          }

          const [result] = await pool.execute(
            `INSERT IGNORE INTO uploaded_images
             (filename, contentType, data, byteSize, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
            [safeName, contentType, data, data.length, Date.now()]
          );
          if (Number(result?.affectedRows || 0) > 0) migrated += 1;
        } catch (fetchError) {
          stillMissing.push({
            itemId: item.id,
            filename: safeName,
            reason: fetchError?.message || 'fetch failed',
          });
        }
      })
    );

    if (migrated > 0) {
      console.log(`Migrated ${migrated} legacy menu image(s) into persistent storage`);
    }
    if (stillMissing.length > 0) {
      console.warn(
        `${stillMissing.length} menu item image(s) could not be recovered into persistent storage ` +
          `and will keep 404ing until re-uploaded by an admin:`,
        stillMissing
      );
    }
  } catch (error) {
    console.error('Failed to migrate legacy menu images', error);
  }
}

// One-time fix for a loyalty cycle off-by-one bug: the reward used to land on order 6, 11,
// 16... instead of 5, 10, 15... (see getLoyaltyCycleStamps in loyalty.js). Shifting every
// existing balance back by one order preserves each customer's current "orders until next
// free cup" exactly as it was under the old math, so nobody who was about to earn a reward
// loses it and nobody gets an undeserved extra one. Guarded by an app_settings flag so this
// can only ever run once, no matter how many times the server restarts.
async function migrateLoyaltyCycleOffset() {
  const MIGRATION_KEY = 'loyaltyPointsCycleFixApplied';
  try {
    const already = await getSetting(MIGRATION_KEY, null);
    if (already === 'true') return;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        'UPDATE loyalty_accounts SET points = GREATEST(points - 1, 0) WHERE points > 0'
      );
      await conn.execute(
        'INSERT INTO app_settings (`key`, `value`, updatedAt) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updatedAt=VALUES(updatedAt)',
        [MIGRATION_KEY, 'true', Date.now()]
      );
      await conn.commit();
      console.log(
        `Loyalty cycle fix: realigned ${result?.affectedRows || 0} customer point balance(s)`
      );
    } catch (txError) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failure
      }
      throw txError;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Failed to run loyalty cycle offset migration', error);
  }
}

// Helpers
async function requireAdmin(c) {
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const sessionUser = await getSessionUser(bearer);
  if (sessionUser?.role === 'admin') {
    // Re-check `active` directly against the database (not the in-memory session cache) so
    // deactivating an admin takes effect on that admin's very next request.
    const [rows] = await pool.execute('SELECT active FROM users WHERE id = ? LIMIT 1', [
      sessionUser.id,
    ]);
    const active = Array.isArray(rows) && rows[0] ? Boolean(Number(rows[0].active)) : false;
    if (!active) {
      sessions.delete(bearer);
      return c.json({ error: 'This admin account has been deactivated' }, 403);
    }
    return null;
  }

  // Optional fallback for scripted/admin tooling (avoid shipping any admin secret to the browser)
  const headerToken = (c.req.header('x-admin-token') || '').trim();
  if (ADMIN_TOKEN_ENABLED && headerToken === ADMIN_TOKEN) return null;

  return c.json({ error: 'Unauthorized' }, 401);
}

// Stricter than requireAdmin: only the phone number configured as ADMIN_PHONE may manage other
// admin accounts, so a second admin can never add accomplices or lock the owner out.
async function requireRootAdmin(c) {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const sessionUser = await getSessionUser(bearer);
  if (sessionUser?.phoneNumber !== ADMIN_PHONE_NORMALIZED) {
    return c.json({ error: 'Only the primary admin can manage admin accounts' }, 403);
  }
  return null;
}

// Cashier or admin session, required for the cashier POS endpoints. Re-checks `active`
// directly against the database (rather than trusting the in-memory session cache) so an
// admin deactivating a cashier takes effect on that cashier's very next request.
async function requireCashier(c) {
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const sessionUser = await getSessionUser(bearer);
  if (!sessionUser || (sessionUser.role !== 'cashier' && sessionUser.role !== 'admin')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (sessionUser.role === 'cashier') {
    const [rows] = await pool.execute('SELECT active FROM users WHERE id = ? LIMIT 1', [
      sessionUser.id,
    ]);
    const active = Array.isArray(rows) && rows[0] ? Boolean(Number(rows[0].active)) : false;
    if (!active) {
      sessions.delete(bearer);
      return c.json({ error: 'This staff account has been deactivated' }, 403);
    }
  }

  c.set('cashierUser', sessionUser);
  return null;
}

function requirePrintDevice(c) {
  if (!PRINT_DEVICE_KEY_ENABLED) return c.json({ error: 'Print device not configured securely' }, 503);
  const key = (c.req.header('X-Device-Key') || '').trim();
  if (!key || !ACCEPTED_PRINT_DEVICE_KEYS.includes(key)) return c.json({ error: 'Unauthorized' }, 401);
  return null;
}

function generatePrintClaimToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getPublicBaseUrl(c) {
  let baseUrl = PUBLIC_BASE_URL;
  if (!baseUrl) {
    const requestUrl = new URL(c.req.url);
    const forwardedProto = String(c.req.header('x-forwarded-proto') || '')
      .split(',')[0]
      .trim();
    const forwardedHost = String(c.req.header('x-forwarded-host') || '')
      .split(',')[0]
      .trim();
    baseUrl = forwardedHost
      ? `${forwardedProto || requestUrl.protocol.replace(':', '')}://${forwardedHost}`
      : requestUrl.origin;
  }

  return normalizePublicHttpUrl(baseUrl);
}

function getPublicImageUrl(c, input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, getPublicBaseUrl(c));
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${getPublicBaseUrl(c)}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function getUploadedFileName(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const pathname = new URL(raw, 'http://localhost').pathname;
    if (!pathname.startsWith('/uploads/')) return '';
    return path.basename(pathname);
  } catch {
    return '';
  }
}

async function deleteUploadedImage(input) {
  const filename = getUploadedFileName(input);
  if (!filename) return;

  await pool.execute('DELETE FROM uploaded_images WHERE filename = ?', [filename]);
  try {
    await fs.unlink(path.join(UPLOADS_DIR, filename));
  } catch {
    // Ignore if the ephemeral local cache is already missing.
  }
}

function getStaticContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (EXT_TO_IMAGE_CONTENT_TYPE[ext]) return EXT_TO_IMAGE_CONTENT_TYPE[ext];
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

async function serveBuiltFile(c, relativePath, fallbackToIndex = false) {
  const normalized = relativePath.replace(/^\/+/, '');
  const targetPath = path.join(BUILD_DIR, normalized || 'index.html');
  try {
    const file = await fs.readFile(targetPath);
    return c.body(file, 200, { 'Content-Type': getStaticContentType(targetPath) });
  } catch {
    if (!fallbackToIndex) return null;
  }

  try {
    const indexPath = path.join(BUILD_DIR, 'index.html');
    const file = await fs.readFile(indexPath);
    return c.body(file, 200, { 'Content-Type': 'text/html; charset=utf-8' });
  } catch {
    return null;
  }
}

async function getSetting(key, fallback) {
  try {
    const [rows] = await pool.execute('SELECT value FROM app_settings WHERE `key` = ? LIMIT 1', [
      key,
    ]);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row || row.value == null) return fallback;
    return String(row.value);
  } catch (e) {
    console.error('Failed to read setting', key, e);
    return fallback;
  }
}

async function setSetting(key, value) {
  await pool.execute(
    'INSERT INTO app_settings (`key`, `value`, updatedAt) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), updatedAt=VALUES(updatedAt)',
    [key, String(value), Date.now()]
  );
}

async function acquireNamedLock(conn, lockName, timeoutSeconds = 10) {
  const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS lockAcquired', [
    lockName,
    Math.max(Number(timeoutSeconds) || 0, 0),
  ]);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return Number(row?.lockAcquired ?? 0) === 1;
}

async function releaseNamedLock(conn, lockName) {
  try {
    await conn.query('SELECT RELEASE_LOCK(?) AS lockReleased', [lockName]);
  } catch (e) {
    console.error('Failed to release named lock', lockName, e);
  }
}

const INVENTORY_TYPES = new Set(['bean', 'sweet']);
const INVENTORY_UNITS = new Set(['g', 'pcs']);
const BEAN_RESTOCK_OPTIONS_G = [500, 1000];
const MANUAL_INVENTORY_REASONS = new Set(['adjustment', 'waste', 'correction']);

function slugifyId(input, fallback = 'item') {
  const base = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || fallback;
}

function parseFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseInventoryType(value) {
  const type = String(value || '')
    .trim()
    .toLowerCase();
  if (!INVENTORY_TYPES.has(type)) return null;
  return type;
}

function parseInventoryUnit(value) {
  const unit = String(value || '')
    .trim()
    .toLowerCase();
  if (!INVENTORY_UNITS.has(unit)) return null;
  return unit;
}

function inferDefaultUnitForInventoryType(type) {
  if (type === 'bean') return 'g';
  if (type === 'sweet') return 'pcs';
  return null;
}

function isIntegerLike(value) {
  return Number.isFinite(value) && Math.floor(value) === value;
}

function validateInventoryTypeUnit(type, unit) {
  if (!type || !unit) return 'Invalid inventory type or unit';
  if (type === 'bean' && unit !== 'g') return 'Beans must use grams (g)';
  if (type === 'sweet' && unit !== 'pcs') return 'Sweets must use pieces (pcs)';
  return null;
}

function roundInventoryQty(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isLowStock(stockQty, lowStockThreshold) {
  return Number(stockQty || 0) <= Number(lowStockThreshold || 0);
}

function shouldSendLowStockAlert({ active, stockQty, lowStockThreshold, lowStockAlertSentAt }) {
  return (
    Boolean(Number(active)) &&
    Number(lowStockThreshold || 0) > 0 &&
    isLowStock(stockQty, lowStockThreshold) &&
    !Number(lowStockAlertSentAt || 0)
  );
}

function mapInventoryItemRow(row) {
  const stockQty = Number(row?.stockQty || 0);
  const lowStockThreshold = Number(row?.lowStockThreshold || 0);
  return {
    id: String(row.id),
    nameEn: String(row.nameEn || ''),
    nameAr: String(row.nameAr || ''),
    type: String(row.type || ''),
    unit: String(row.unit || ''),
    stockQty,
    lowStockThreshold,
    lowStockAlertSentAt: row?.lowStockAlertSentAt != null ? Number(row.lowStockAlertSentAt) : null,
    active: Boolean(Number(row.active)),
    notes: row.notes != null ? String(row.notes) : null,
    isLowStock: isLowStock(stockQty, lowStockThreshold),
    createdAt: row.createdAt != null ? Number(row.createdAt) : null,
    updatedAt: row.updatedAt != null ? Number(row.updatedAt) : null,
  };
}

function mapInventoryRuleRow(row) {
  return {
    id: Number(row.id),
    menuItemId: String(row.menuItemId),
    inventoryItemId: String(row.inventoryItemId),
    consumeQty: Number(row.consumeQty || 0),
    menuItem: {
      id: String(row.menuItemId),
      nameEn: String(row.menuNameEn || ''),
      nameAr: String(row.menuNameAr || ''),
      category: row.menuCategory != null ? String(row.menuCategory) : null,
      available: row.menuAvailable != null ? Boolean(Number(row.menuAvailable)) : null,
    },
    inventoryItem: {
      id: String(row.inventoryItemId),
      nameEn: String(row.inventoryNameEn || ''),
      nameAr: String(row.inventoryNameAr || ''),
      type: row.inventoryType != null ? String(row.inventoryType) : null,
      unit: row.inventoryUnit != null ? String(row.inventoryUnit) : null,
      active: row.inventoryActive != null ? Boolean(Number(row.inventoryActive)) : null,
    },
    createdAt: row.createdAt != null ? Number(row.createdAt) : null,
    updatedAt: row.updatedAt != null ? Number(row.updatedAt) : null,
  };
}

function mapInventoryMovementRow(row) {
  return {
    id: Number(row.id || 0),
    inventoryItemId: String(row.inventoryItemId || ''),
    direction: String(row.direction || ''),
    qty: Number(row.qty || 0),
    reason: String(row.reason || ''),
    orderId: row.orderId != null ? String(row.orderId) : null,
    note: row.note != null ? String(row.note) : null,
    createdByUserId: row.createdByUserId != null ? String(row.createdByUserId) : null,
    createdByName: row.createdByName != null ? String(row.createdByName) : null,
    createdAt: row.createdAt != null ? Number(row.createdAt) : null,
  };
}

async function getAdminSessionUserFromRequest(c) {
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const sessionUser = await getSessionUser(bearer);
  return sessionUser?.role === 'admin' ? sessionUser : null;
}

// Initialize DB schema
await ensureDatabase();
await initSchema();
await ensureUploadsDir();
await backfillLocalUploads();
await migrateLegacyItemImages();
await migrateLoyaltyCycleOffset();

// Serve uploaded images
app.get('/uploads/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!filename) {
    c.header('Cache-Control', 'no-store');
    return c.text('Not found', 404);
  }

  const safeName = path.basename(filename);
  try {
    const filePath = path.join(UPLOADS_DIR, safeName);
    const data = await fs.readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = EXT_TO_IMAGE_CONTENT_TYPE[ext] || 'application/octet-stream';

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    // Railway local storage is ephemeral; persistent storage is the source of truth.
  }

  try {
    const [rows] = await pool.execute(
      'SELECT contentType, data, byteSize FROM uploaded_images WHERE filename = ? LIMIT 1',
      [safeName]
    );
    const stored = rows?.[0];
    if (stored?.data) {
      const data = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data);
      return new Response(data, {
        headers: {
          'Content-Type': String(stored.contentType || 'application/octet-stream'),
          'Content-Length': String(Number(stored.byteSize) || data.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch (error) {
    console.error('Failed to read uploaded image from persistent storage', error);
  }

  c.header('Cache-Control', 'no-store');
  return c.text('Not found', 404);
});

// Health
app.get('/api/health', async (c) => {
  const timestamp = Date.now();
  let dbStatus = 'unknown';
  let dbLatencyMs = null;
  if (HEALTHCHECK_DB) {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      dbStatus = 'ok';
      dbLatencyMs = Date.now() - start;
    } catch (e) {
      dbStatus = 'error';
      dbLatencyMs = Date.now() - start;
      console.error('Healthcheck DB query failed', e);
    }
  }

  const payload = {
    status: dbStatus === 'error' ? 'degraded' : 'healthy',
    timestamp,
    version: 'mysql-1.0.0',
    db: dbStatus,
    telegramAgent: getTelegramAgentStatus(),
    ...(dbLatencyMs != null ? { dbLatencyMs } : {}),
  };

  if (dbStatus === 'error' && HEALTHCHECK_STRICT) {
    return c.json(payload, 503);
  }
  return c.json(payload);
});

app.post('/api/telegram/webhook', async (c) => {
  const update = await c.req.json().catch(() => null);
  if (!update) return c.json({ error: 'Invalid Telegram update' }, 400);
  const result = await handleTelegramUpdate(
    update,
    c.req.header('X-Telegram-Bot-Api-Secret-Token') || ''
  );
  return c.json(result.body, result.status);
});
app.get('/', async (c) => {
  const served = await serveBuiltFile(c, 'index.html', true);
  if (served) return served;
  return c.text('OK');
});

// Public settings (open status + hours)
app.get('/api/settings/public', async (c) => {
  const status = await getEffectiveOpenStatus();
  return c.json({ success: true, ...status });
});

app.post('/api/auth/send-otp', async (c) => {
  try {
    const { phoneNumber, language, method } = await c.req.json();
    if (!phoneNumber) return c.json({ error: 'Phone number required' }, 400);

    const normalizedPhone = normalizeKsaPhone(phoneNumber);
    if (!normalizedPhone) return c.json({ error: 'Invalid phone number' }, 400);

    const now = Date.now();

    if (!OTP_DEV_MODE) {
      const [latest] = await pool.execute(
        'SELECT createdAt FROM otp_codes WHERE phoneNumber = ? ORDER BY createdAt DESC LIMIT 1',
        [normalizedPhone]
      );
      const lastCreatedAt =
        Array.isArray(latest) && latest[0] ? Number(latest[0].createdAt || 0) : 0;
      if (lastCreatedAt && now - lastCreatedAt < OTP_RESEND_MIN_MS) {
        const retryAfterMs = OTP_RESEND_MIN_MS - (now - lastCreatedAt);
        return c.json({ error: 'Please wait before requesting another code', retryAfterMs }, 429);
      }

      const [cntRows] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM otp_codes WHERE phoneNumber = ? AND createdAt >= ?',
        [normalizedPhone, now - 60 * 60 * 1000]
      );
      const hourCount = Number(cntRows?.[0]?.cnt || 0);
      if (hourCount >= OTP_MAX_PER_HOUR) {
        return c.json({ error: 'Too many requests. Try again later.' }, 429);
      }
    }

    const code = OTP_DEV_MODE ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = hashOtp(code);
    const expiresAt = now + OTP_TTL_MS;

    const [res] = await pool.execute(
      'INSERT INTO otp_codes (phoneNumber, codeHash, attempts, createdAt, expiresAt, consumedAt) VALUES (?, ?, ?, ?, ?, NULL)',
      [normalizedPhone, codeHash, 0, now, expiresAt]
    );

    if (!OTP_DEV_MODE) {
      try {
        await sendOtpSms({
          phoneNumber: normalizedPhone,
          code,
          language: language === 'ar' ? 'ar' : 'en',
          method: method === 'whatsapp' ? 'whatsapp' : 'sms',
        });
      } catch (e) {
        // Cleanup: remove OTP row if SMS send failed
        try {
          await pool.execute('DELETE FROM otp_codes WHERE id = ?', [res.insertId]);
        } catch {
          // ignore
        }
        throw e;
      }
    }

    const shouldReturn = OTP_DEV_MODE || OTP_DEBUG_RETURN_CODE;
    return c.json({ success: true, ...(shouldReturn ? { otp: code } : {}) });
  } catch (e) {
    console.error('Failed to send OTP', e);
    return c.json({ error: 'Failed to send OTP' }, 500);
  }
});

app.post('/api/auth/verify-otp', async (c) => {
  try {
    const { phoneNumber, otp } = await c.req.json();
    if (!phoneNumber || !otp) return c.json({ error: 'Phone and OTP required' }, 400);

    const normalizedPhone = normalizeKsaPhone(phoneNumber);
    if (!normalizedPhone) return c.json({ error: 'Invalid phone number' }, 400);

    const now = Date.now();
    const [rows] = await pool.execute(
      'SELECT * FROM otp_codes WHERE phoneNumber = ? AND consumedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1',
      [normalizedPhone, now]
    );
    const rec = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!rec) return c.json({ error: 'No valid code found. Request a new one.' }, 400);

    if (Number(rec.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      return c.json({ error: 'Too many attempts. Request a new code.' }, 429);
    }

    const incoming = String(otp).trim();
    if (OTP_DEV_MODE && incoming !== '123456') {
      return c.json({ error: 'Invalid code' }, 401);
    }
    const matches = hashOtp(incoming) === String(rec.codeHash);
    if (!matches) {
      await pool.execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [rec.id]);
      return c.json({ error: 'Invalid code' }, 401);
    }

    await pool.execute('UPDATE otp_codes SET consumedAt = ? WHERE id = ?', [now, rec.id]);

    const adminPhone = normalizeKsaPhone(ADMIN_PHONE);
    const id = `user:${normalizedPhone}`;
    const [userRows] = await pool.execute(
      'SELECT name, email, language, role FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    const existing = Array.isArray(userRows) && userRows[0] ? userRows[0] : null;
    const existingName = String(existing?.name || '').trim();
    const existingRole = String(existing?.role || '').trim();
    const role = normalizedPhone === adminPhone ? 'admin' : existingRole || 'user';
    const effectiveName = existingName || 'Guest';

    // Persist user record (upsert) without clobbering existing name
    await pool.execute(
      'INSERT INTO users (id, phoneNumber, name, email, language, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE role=VALUES(role), updatedAt=VALUES(updatedAt)',
      [id, normalizedPhone, effectiveName, null, null, role, Date.now(), Date.now()]
    );
    const user = {
      id,
      phoneNumber: normalizedPhone,
      name: effectiveName,
      role,
      isRootAdmin: normalizedPhone === adminPhone,
    };
    const sessionToken = `sess_${crypto.randomBytes(24).toString('base64url')}`;
    const sessionTokenHash = hashSessionToken(sessionToken);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(sessionToken, { user, expiresAt });
    await pool.execute(
      'INSERT INTO sessions (token, userId, createdAt, lastSeenAt, expiresAt) VALUES (?, ?, ?, ?, ?)',
      [sessionTokenHash, id, Date.now(), Date.now(), expiresAt]
    );
    return c.json({ success: true, user, sessionToken });
  } catch {
    return c.json({ error: 'Failed to verify OTP' }, 500);
  }
});

function normalizeKsaPhone(input) {
  if (!input) return null;
  const raw = String(input)
    .trim()
    .replace(/[\s\-()]/g, '');
  const digits = raw.replace(/^\+/, '').replace(/\D/g, '');

  // Accept 05xxxxxxxx (10 digits)
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  // Accept 5xxxxxxxx (9 digits)
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  // Accept 9665xxxxxxxx
  if (/^9665\d{8}$/.test(digits)) return digits;

  return null;
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(`${OTP_PEPPER}:${code}`).digest('hex');
}

app.post('/api/auth/complete-profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const existing = await getSessionUser(token);
    if (!existing) return c.json({ error: 'Unauthorized' }, 401);
    const { name, email, language } = await c.req.json();
    const updatedUser = { ...existing, name: (name || '').trim() || existing.name };
    const existingSession = sessions.get(token);
    const expiresAt = existingSession?.expiresAt ?? Date.now() + SESSION_TTL_MS;
    sessions.set(token, { user: updatedUser, expiresAt });
    // Persist profile updates
    await pool.execute('UPDATE users SET name=?, email=?, language=?, updatedAt=? WHERE id=?', [
      updatedUser.name,
      email ?? null,
      language ?? null,
      Date.now(),
      updatedUser.id,
    ]);
    await touchSessionRecord(token, Date.now());
    return c.json({ success: true, user: updatedUser });
  } catch {
    return c.json({ error: 'Failed to complete profile' }, 500);
  }
});

app.post('/api/auth/verify-session', async (c) => {
  try {
    const { sessionToken } = await c.req.json();
    if (!sessionToken) return c.json({ error: 'Session token required' }, 400);
    const user = await getSessionUser(sessionToken);
    if (!user) return c.json({ success: false, error: 'Invalid session' }, 401);
    return c.json({ success: true, user });
  } catch {
    return c.json({ error: 'Failed to verify session' }, 500);
  }
});

// Profile endpoints
app.get('/api/profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [sessionUser.id]);
    const dbUser = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const user = dbUser || sessionUser;
    return c.json({ success: true, user });
  } catch (e) {
    console.error('Error fetching profile', e);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

app.put('/api/profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);
    const { name, email, language } = await c.req.json();
    // Update DB
    await pool.execute('UPDATE users SET name=?, email=?, language=?, updatedAt=? WHERE id=?', [
      (name || sessionUser.name || 'Guest').trim(),
      email ?? null,
      language ?? null,
      Date.now(),
      sessionUser.id,
    ]);
    // Update session
    const updatedUser = { ...sessionUser, name: (name || sessionUser.name || 'Guest').trim() };
    const existingSession = sessions.get(token);
    const expiresAt = existingSession?.expiresAt ?? Date.now() + SESSION_TTL_MS;
    sessions.set(token, { user: updatedUser, expiresAt });
    await touchSessionRecord(token, Date.now());
    return c.json({ success: true, user: updatedUser });
  } catch (e) {
    console.error('Error updating profile', e);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

// Loyalty endpoints
app.post('/api/profile/loyalty/enable', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);
    const userId = sessionUser.id;
    const now = Date.now();
    await pool.execute(
      'INSERT INTO loyalty_accounts (userId, points, tier, enabled, enrollmentDate) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), tier=VALUES(tier), enrollmentDate=IFNULL(loyalty_accounts.enrollmentDate, VALUES(enrollmentDate))',
      [userId, 0, 'basic', 1, now]
    );
    const [rows] = await pool.execute('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
    const loyalty =
      Array.isArray(rows) && rows[0]
        ? rows[0]
        : { userId, points: 0, tier: 'basic', enabled: 1, enrollmentDate: now };
    return c.json({ success: true, loyalty });
  } catch (e) {
    console.error('Error enabling loyalty', e);
    return c.json({ error: 'Failed to enable loyalty' }, 500);
  }
});

app.post('/api/profile/loyalty/disable', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);
    const userId = sessionUser.id;
    await pool.execute(
      'INSERT INTO loyalty_accounts (userId, points, tier, enabled, enrollmentDate) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
      [userId, 0, 'basic', 0, null]
    );
    const [rows] = await pool.execute('SELECT * FROM loyalty_accounts WHERE userId = ?', [userId]);
    const loyalty =
      Array.isArray(rows) && rows[0]
        ? rows[0]
        : { userId, points: 0, tier: 'basic', enabled: 0, enrollmentDate: null };
    return c.json({ success: true, loyalty });
  } catch (e) {
    console.error('Error disabling loyalty', e);
    return c.json({ error: 'Failed to disable loyalty' }, 500);
  }
});

app.get('/api/profile/loyalty', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);
    const userId = sessionUser.id;

    // Back-fill a missing loyalty_accounts row from order history (e.g. very old data from
    // before this table existed). Once a row exists, createOrderInternal's accrual logic is the
    // sole source of truth for `points` and `enabled` — points may intentionally sit behind the
    // raw order count while an earned reward is still unclaimed (see shouldAccrueLoyaltyPoint),
    // and `enabled` may be off because the customer explicitly opted out via
    // /api/profile/loyalty/disable. Neither is ever "corrected" back here.
    const [rows] = await pool.execute('SELECT * FROM loyalty_accounts WHERE userId = ? LIMIT 1', [
      userId,
    ]);
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;

    if (!existing) {
      const [orderRows] = await pool.execute('SELECT COUNT(*) AS cnt FROM orders WHERE userId = ?', [
        userId,
      ]);
      const orderCount = Number(orderRows?.[0]?.cnt || 0);
      if (orderCount > 0) {
        const nowTs = Date.now();
        await pool.execute(
          'INSERT INTO loyalty_accounts (userId, points, tier, enabled, enrollmentDate) VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
          [userId, orderCount, 'basic', nowTs]
        );
      }
    }

    const [freshRows] = await pool.execute(
      'SELECT * FROM loyalty_accounts WHERE userId = ? LIMIT 1',
      [userId]
    );
    const loyalty =
      Array.isArray(freshRows) && freshRows[0]
        ? freshRows[0]
        : { userId, points: 0, tier: 'basic', enabled: 0, enrollmentDate: null };

    return c.json({ success: true, loyalty });
  } catch (e) {
    console.error('Error fetching loyalty account', e);
    return c.json({ error: 'Failed to fetch loyalty account' }, 500);
  }
});

// Menu
app.get('/api/menu/items', async (c) => {
  try {
    const [items] = await pool.execute('SELECT * FROM items');
    const [categories] = await pool.execute('SELECT * FROM categories ORDER BY `order` ASC');
    const publicItems = items.map((item) => ({
      ...item,
      imageUrl: getPublicImageUrl(c, item.imageUrl),
    }));
    return c.json({ success: true, items: publicItems, categories });
  } catch (e) {
    console.error('Error fetching menu', e);
    return c.json({ error: 'Failed to fetch menu' }, 500);
  }
});

// Admin Menu (secure)
app.get('/api/admin/menu', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [items] = await pool.execute('SELECT * FROM items');
    const [categories] = await pool.execute('SELECT * FROM categories ORDER BY `order` ASC');
    const publicItems = items.map((item) => ({
      ...item,
      imageUrl: getPublicImageUrl(c, item.imageUrl),
    }));
    return c.json({ success: true, items: publicItems, categories });
  } catch (e) {
    console.error('Error fetching admin menu', e);
    return c.json({ error: 'Failed to fetch admin menu' }, 500);
  }
});

// Admin: list menu items whose imageUrl is set but not actually recoverable — i.e. missing
// from persistent storage, so they will 404 (this is the state that causes "images not
// loading" to recur after every deploy, since Railway's local disk cache is wiped on restart).
app.get('/api/admin/menu/broken-images', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [items] = await pool.execute(
      `SELECT id, nameEn, imageUrl FROM items WHERE imageUrl IS NOT NULL AND imageUrl <> ''`
    );
    const broken = [];
    for (const item of items) {
      const filename = getUploadedFileName(item.imageUrl);
      if (!filename) continue; // externally-hosted image URL, not our upload pipeline
      const [rows] = await pool.execute(
        'SELECT filename FROM uploaded_images WHERE filename = ? LIMIT 1',
        [filename]
      );
      if (!rows.length) {
        broken.push({ id: item.id, nameEn: item.nameEn, imageUrl: item.imageUrl, filename });
      }
    }
    return c.json({ success: true, broken, count: broken.length });
  } catch (e) {
    console.error('Error checking for broken menu images', e);
    return c.json({ error: 'Failed to check menu images' }, 500);
  }
});

// Admin Inventory: summary (items + rules + menu link warnings)
app.get('/api/admin/inventory', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const includeUnavailableMenu = String(c.req.query('includeUnavailableMenu') || '')
      .trim()
      .toLowerCase() === 'true';

    const [inventoryRows] = await pool.execute(
      'SELECT * FROM inventory_items ORDER BY active DESC, type ASC, nameEn ASC'
    );
    const [ruleRows] = await pool.execute(`
      SELECT
        r.*,
        i.nameEn AS menuNameEn,
        i.nameAr AS menuNameAr,
        i.category AS menuCategory,
        i.available AS menuAvailable,
        inv.nameEn AS inventoryNameEn,
        inv.nameAr AS inventoryNameAr,
        inv.type AS inventoryType,
        inv.unit AS inventoryUnit,
        inv.active AS inventoryActive
      FROM inventory_usage_rules r
      JOIN items i ON i.id = r.menuItemId
      JOIN inventory_items inv ON inv.id = r.inventoryItemId
      ORDER BY i.category ASC, i.nameEn ASC, inv.nameEn ASC
    `);
    const [menuRows] = await pool.execute(
      'SELECT id, nameEn, nameAr, category, available FROM items ORDER BY category ASC, nameEn ASC'
    );
    const [unlinkedRows] = await pool.execute(
      `SELECT i.id, i.nameEn, i.nameAr, i.category, i.available
       FROM items i
       LEFT JOIN inventory_usage_rules r ON r.menuItemId = i.id
       WHERE r.id IS NULL ${includeUnavailableMenu ? '' : 'AND i.available = 1'}
       ORDER BY i.category ASC, i.nameEn ASC`
    );

    const inventoryItems = (Array.isArray(inventoryRows) ? inventoryRows : []).map(mapInventoryItemRow);
    const usageRules = (Array.isArray(ruleRows) ? ruleRows : []).map(mapInventoryRuleRow);
    const menuItems = (Array.isArray(menuRows) ? menuRows : []).map((r) => ({
      id: String(r.id),
      nameEn: String(r.nameEn || ''),
      nameAr: String(r.nameAr || ''),
      category: r.category != null ? String(r.category) : null,
      available: Boolean(Number(r.available)),
    }));
    const unlinkedMenuItems = (Array.isArray(unlinkedRows) ? unlinkedRows : []).map((r) => ({
      id: String(r.id),
      nameEn: String(r.nameEn || ''),
      nameAr: String(r.nameAr || ''),
      category: r.category != null ? String(r.category) : null,
      available: Boolean(Number(r.available)),
    }));

    return c.json({
      success: true,
      inventoryItems,
      usageRules,
      menuItems,
      unlinkedMenuItems,
      warnings: {
        unlinkedInventoryCount: unlinkedMenuItems.length,
      },
      restockOptions: {
        beanG: BEAN_RESTOCK_OPTIONS_G,
      },
    });
  } catch (e) {
    console.error('Error fetching inventory summary', e);
    return c.json({ error: 'Failed to fetch inventory summary' }, 500);
  }
});

// Admin Inventory: list usage rules only
app.get('/api/admin/inventory/rules', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(`
      SELECT
        r.*,
        i.nameEn AS menuNameEn,
        i.nameAr AS menuNameAr,
        i.category AS menuCategory,
        i.available AS menuAvailable,
        inv.nameEn AS inventoryNameEn,
        inv.nameAr AS inventoryNameAr,
        inv.type AS inventoryType,
        inv.unit AS inventoryUnit,
        inv.active AS inventoryActive
      FROM inventory_usage_rules r
      JOIN items i ON i.id = r.menuItemId
      JOIN inventory_items inv ON inv.id = r.inventoryItemId
      ORDER BY i.category ASC, i.nameEn ASC, inv.nameEn ASC
    `);
    return c.json({
      success: true,
      rules: (Array.isArray(rows) ? rows : []).map(mapInventoryRuleRow),
    });
  } catch (e) {
    console.error('Error fetching inventory rules', e);
    return c.json({ error: 'Failed to fetch inventory rules' }, 500);
  }
});

// Admin Inventory Item: create
app.post('/api/admin/inventory/item', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const body = await c.req.json().catch(() => ({}));
    const nameEn = String(body?.nameEn || '').trim();
    const nameAr = String(body?.nameAr || '').trim();
    if (!nameEn || !nameAr) {
      return c.json({ error: 'nameEn and nameAr are required' }, 400);
    }

    const type = parseInventoryType(body?.type);
    if (!type) return c.json({ error: 'Invalid inventory type (bean|sweet)' }, 400);
    const unit = parseInventoryUnit(body?.unit) || inferDefaultUnitForInventoryType(type);
    const typeUnitError = validateInventoryTypeUnit(type, unit);
    if (typeUnitError) return c.json({ error: typeUnitError }, 400);

    const lowStockThresholdNum = parseFiniteNumber(body?.lowStockThreshold ?? 0);
    if (lowStockThresholdNum == null || lowStockThresholdNum < 0) {
      return c.json({ error: 'lowStockThreshold must be a non-negative number' }, 400);
    }
    if (unit === 'pcs' && !isIntegerLike(lowStockThresholdNum)) {
      return c.json({ error: 'lowStockThreshold must be a whole number for pcs units' }, 400);
    }

    const active =
      body?.active == null ? true : Boolean(body.active);
    const notes =
      body?.notes == null ? null : String(body.notes).trim() || null;

    const inputId = String(body?.id || '').trim();
    const id = inputId || `${slugifyId(nameEn, 'inventory')}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    await pool.execute(
      `INSERT INTO inventory_items
       (id, nameEn, nameAr, type, unit, stockQty, lowStockThreshold, lowStockAlertSentAt, active, notes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, nameEn, nameAr, type, unit, 0, lowStockThresholdNum, null, active ? 1 : 0, notes, now, now]
    );

    return c.json({
      success: true,
      item: mapInventoryItemRow({
        id,
        nameEn,
        nameAr,
        type,
        unit,
        stockQty: 0,
        lowStockThreshold: lowStockThresholdNum,
        lowStockAlertSentAt: null,
        active: active ? 1 : 0,
        notes,
        createdAt: now,
        updatedAt: now,
      }),
    });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return c.json({ error: 'Inventory item id already exists' }, 409);
    }
    console.error('Error creating inventory item', e);
    return c.json({ error: 'Failed to create inventory item' }, 500);
  }
});

// Admin Inventory Item: update metadata (not stock)
app.put('/api/admin/inventory/item/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = String(c.req.param('id') || '').trim();
    if (!id) return c.json({ error: 'Inventory item id is required' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const [rows] = await pool.execute('SELECT * FROM inventory_items WHERE id = ? LIMIT 1', [id]);
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!existing) return c.json({ error: 'Inventory item not found' }, 404);

    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    const nextNameEn = has('nameEn') ? String(body.nameEn || '').trim() : String(existing.nameEn || '');
    const nextNameAr = has('nameAr') ? String(body.nameAr || '').trim() : String(existing.nameAr || '');
    if (!nextNameEn || !nextNameAr) {
      return c.json({ error: 'nameEn and nameAr are required' }, 400);
    }

    const nextType = has('type') ? parseInventoryType(body.type) : String(existing.type || '');
    if (!nextType) return c.json({ error: 'Invalid inventory type (bean|sweet)' }, 400);
    const nextUnit =
      has('unit')
        ? parseInventoryUnit(body.unit)
        : parseInventoryUnit(existing.unit) || inferDefaultUnitForInventoryType(nextType);
    const typeUnitError = validateInventoryTypeUnit(nextType, nextUnit);
    if (typeUnitError) return c.json({ error: typeUnitError }, 400);

    const lowStockThresholdRaw = has('lowStockThreshold')
      ? body.lowStockThreshold
      : existing.lowStockThreshold;
    const nextLowStockThreshold = parseFiniteNumber(lowStockThresholdRaw);
    if (nextLowStockThreshold == null || nextLowStockThreshold < 0) {
      return c.json({ error: 'lowStockThreshold must be a non-negative number' }, 400);
    }
    if (nextUnit === 'pcs' && !isIntegerLike(nextLowStockThreshold)) {
      return c.json({ error: 'lowStockThreshold must be a whole number for pcs units' }, 400);
    }

    const nextActive = has('active') ? Boolean(body.active) : Boolean(Number(existing.active));
    const nextNotes = has('notes')
      ? body.notes == null
        ? null
        : String(body.notes).trim() || null
      : existing.notes != null
        ? String(existing.notes)
        : null;
    const now = Date.now();
    const nextStockQty = roundInventoryQty(existing.stockQty);
    const existingLowStockAlertSentAt =
      existing.lowStockAlertSentAt != null ? Number(existing.lowStockAlertSentAt) : null;
    const nextLowStockAlertSentAt = shouldSendLowStockAlert({
      active: nextActive ? 1 : 0,
      stockQty: nextStockQty,
      lowStockThreshold: nextLowStockThreshold,
      lowStockAlertSentAt: existingLowStockAlertSentAt,
    })
      ? now
      : Boolean(nextActive) &&
          Number(nextLowStockThreshold) > 0 &&
          isLowStock(nextStockQty, nextLowStockThreshold)
        ? existingLowStockAlertSentAt
        : null;
    const shouldNotifyLowStock =
      nextLowStockAlertSentAt === now && existingLowStockAlertSentAt !== nextLowStockAlertSentAt;

    await pool.execute(
      `UPDATE inventory_items
       SET nameEn = ?, nameAr = ?, type = ?, unit = ?, lowStockThreshold = ?, lowStockAlertSentAt = ?, active = ?, notes = ?, updatedAt = ?
       WHERE id = ?`,
      [
        nextNameEn,
        nextNameAr,
        nextType,
        nextUnit,
        nextLowStockThreshold,
        nextLowStockAlertSentAt,
        nextActive ? 1 : 0,
        nextNotes,
        now,
        id,
      ]
    );

    const responsePayload = {
      success: true,
      item: mapInventoryItemRow({
        ...existing,
        id,
        nameEn: nextNameEn,
        nameAr: nextNameAr,
        type: nextType,
        unit: nextUnit,
        lowStockThreshold: nextLowStockThreshold,
        lowStockAlertSentAt: nextLowStockAlertSentAt,
        active: nextActive ? 1 : 0,
        notes: nextNotes,
        updatedAt: now,
      }),
    };

    if (shouldNotifyLowStock) {
      sendInventoryLowStockNotification({
        id,
        nameEn: nextNameEn,
        nameAr: nextNameAr,
        unit: nextUnit,
        stockQty: nextStockQty,
        lowStockThreshold: nextLowStockThreshold,
      }).catch((notificationError) => {
        console.error('Failed to send low stock notification after inventory update', {
          inventoryItemId: id,
          error: notificationError?.message || notificationError,
        });
      });
    }

    return c.json(responsePayload);
  } catch (e) {
    console.error('Error updating inventory item', e);
    return c.json({ error: 'Failed to update inventory item' }, 500);
  }
});

// Admin Inventory Item: restock
app.post('/api/admin/inventory/item/:id/restock', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  const conn = await pool.getConnection();
  try {
    const id = String(c.req.param('id') || '').trim();
    if (!id) return c.json({ error: 'Inventory item id is required' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const qty = parseFiniteNumber(body?.qty);
    if (qty == null || qty <= 0) {
      return c.json({ error: 'qty must be a positive number' }, 400);
    }

    const adminUser = await getAdminSessionUserFromRequest(c);
    const note = body?.note == null ? null : String(body.note).trim() || null;

    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT * FROM inventory_items WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );
    const item = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!item) {
      await conn.rollback();
      return c.json({ error: 'Inventory item not found' }, 404);
    }

    const itemType = String(item.type || '');
    const itemUnit = String(item.unit || '');
    if (itemType === 'bean') {
      if (itemUnit !== 'g') {
        await conn.rollback();
        return c.json({ error: 'Bean inventory must use grams (g)' }, 400);
      }
      if (!BEAN_RESTOCK_OPTIONS_G.includes(Number(qty))) {
        await conn.rollback();
        return c.json({ error: 'Bean restock qty must be 500g or 1000g' }, 400);
      }
    }
    if (itemUnit === 'pcs' && !isIntegerLike(qty)) {
      await conn.rollback();
      return c.json({ error: 'qty must be a whole number for pcs units' }, 400);
    }

    const now = Date.now();
    const nextStockQty = roundInventoryQty(Number(item.stockQty || 0) + Number(qty));
    const lowStockThreshold = Number(item.lowStockThreshold || 0);
    const nextLowStockAlertSentAt =
      Boolean(Number(item.active)) &&
      Number(lowStockThreshold) > 0 &&
      isLowStock(nextStockQty, lowStockThreshold)
        ? item.lowStockAlertSentAt != null
          ? Number(item.lowStockAlertSentAt)
          : null
        : null;

    await conn.execute(
      'UPDATE inventory_items SET stockQty = ?, lowStockAlertSentAt = ?, updatedAt = ? WHERE id = ?',
      [nextStockQty, nextLowStockAlertSentAt, now, id]
    );
    const [movementRes] = await conn.execute(
      `INSERT INTO inventory_movements
       (inventoryItemId, direction, qty, reason, orderId, note, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 'in', qty, 'restock', null, note, adminUser?.id || null, now]
    );

    await conn.commit();

    return c.json({
      success: true,
      item: mapInventoryItemRow({
        ...item,
        stockQty: nextStockQty,
        lowStockAlertSentAt: nextLowStockAlertSentAt,
        updatedAt: now,
      }),
      movement: {
        id: Number(movementRes.insertId || 0),
        inventoryItemId: id,
        direction: 'in',
        qty: Number(qty),
        reason: 'restock',
        orderId: null,
        note,
        createdByUserId: adminUser?.id || null,
        createdAt: now,
      },
    });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback failure; original error is returned below
    }
    console.error('Error restocking inventory item', e);
    return c.json({ error: 'Failed to restock inventory item' }, 500);
  } finally {
    conn.release();
  }
});

// Admin Inventory Item: recent movements
app.get('/api/admin/inventory/item/:id/movements', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = String(c.req.param('id') || '').trim();
    if (!id) return c.json({ error: 'Inventory item id is required' }, 400);
    const requestedLimit = Number(c.req.query('limit') || 8);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 8, 50));

    const [rows] = await pool.execute(
      `SELECT
         m.*,
         u.name AS createdByName
       FROM inventory_movements m
       LEFT JOIN users u ON u.id = m.createdByUserId
       WHERE m.inventoryItemId = ?
       ORDER BY m.createdAt DESC, m.id DESC
       LIMIT ?`,
      [id, limit]
    );

    return c.json({
      success: true,
      movements: (Array.isArray(rows) ? rows : []).map(mapInventoryMovementRow),
    });
  } catch (e) {
    console.error('Error fetching inventory movements', e);
    return c.json({ error: 'Failed to fetch inventory movements' }, 500);
  }
});

// Admin Inventory Item: manual adjustment
app.post('/api/admin/inventory/item/:id/adjust', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  const conn = await pool.getConnection();
  try {
    const id = String(c.req.param('id') || '').trim();
    if (!id) return c.json({ error: 'Inventory item id is required' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const qtyDelta = parseFiniteNumber(body?.qtyDelta);
    if (qtyDelta == null || qtyDelta === 0) {
      return c.json({ error: 'qtyDelta must be a non-zero number' }, 400);
    }

    const reasonRaw = String(body?.reason || 'adjustment')
      .trim()
      .toLowerCase();
    const reason = MANUAL_INVENTORY_REASONS.has(reasonRaw) ? reasonRaw : null;
    if (!reason) {
      return c.json({ error: 'Invalid adjustment reason' }, 400);
    }

    const note = body?.note == null ? null : String(body.note).trim() || null;
    const adminUser = await getAdminSessionUserFromRequest(c);

    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT * FROM inventory_items WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );
    const item = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!item) {
      await conn.rollback();
      return c.json({ error: 'Inventory item not found' }, 404);
    }

    const itemUnit = String(item.unit || '');
    if (itemUnit === 'pcs' && !isIntegerLike(qtyDelta)) {
      await conn.rollback();
      return c.json({ error: 'qtyDelta must be a whole number for pcs units' }, 400);
    }

    const currentStockQty = roundInventoryQty(Number(item.stockQty || 0));
    const nextStockQty = roundInventoryQty(currentStockQty + Number(qtyDelta));
    if (nextStockQty < 0) {
      await conn.rollback();
      return c.json(
        {
          error: 'Adjustment would make stock negative',
          currentStockQty,
          qtyDelta,
        },
        409
      );
    }

    const now = Date.now();
    const lowStockThreshold = Number(item.lowStockThreshold || 0);
    const existingLowStockAlertSentAt =
      item.lowStockAlertSentAt != null ? Number(item.lowStockAlertSentAt) : null;
    const nextLowStockAlertSentAt = shouldSendLowStockAlert({
      active: item.active,
      stockQty: nextStockQty,
      lowStockThreshold,
      lowStockAlertSentAt: existingLowStockAlertSentAt,
    })
      ? now
      : Boolean(Number(item.active)) &&
          Number(lowStockThreshold) > 0 &&
          isLowStock(nextStockQty, lowStockThreshold)
        ? existingLowStockAlertSentAt
        : null;
    const shouldNotifyLowStock =
      nextLowStockAlertSentAt === now && existingLowStockAlertSentAt !== nextLowStockAlertSentAt;
    const movementDirection = Number(qtyDelta) > 0 ? 'in' : 'out';
    const movementQty = Math.abs(roundInventoryQty(qtyDelta));

    await conn.execute(
      'UPDATE inventory_items SET stockQty = ?, lowStockAlertSentAt = ?, updatedAt = ? WHERE id = ?',
      [nextStockQty, nextLowStockAlertSentAt, now, id]
    );
    const [movementRes] = await conn.execute(
      `INSERT INTO inventory_movements
       (inventoryItemId, direction, qty, reason, orderId, note, createdByUserId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, movementDirection, movementQty, reason, null, note, adminUser?.id || null, now]
    );

    await conn.commit();

    if (shouldNotifyLowStock) {
      sendInventoryLowStockNotification({
        id,
        nameEn: String(item.nameEn || ''),
        nameAr: String(item.nameAr || ''),
        unit: itemUnit,
        stockQty: nextStockQty,
        lowStockThreshold,
      }).catch((notificationError) => {
        console.error('Failed to send low stock notification after manual adjustment', {
          inventoryItemId: id,
          error: notificationError?.message || notificationError,
        });
      });
    }

    return c.json({
      success: true,
      item: mapInventoryItemRow({
        ...item,
        stockQty: nextStockQty,
        lowStockAlertSentAt: nextLowStockAlertSentAt,
        updatedAt: now,
      }),
      movement: mapInventoryMovementRow({
        id: Number(movementRes.insertId || 0),
        inventoryItemId: id,
        direction: movementDirection,
        qty: movementQty,
        reason,
        orderId: null,
        note,
        createdByUserId: adminUser?.id || null,
        createdByName: adminUser?.name || null,
        createdAt: now,
      }),
    });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback failure; original error is returned below
    }
    console.error('Error adjusting inventory item', e);
    return c.json({ error: 'Failed to adjust inventory item' }, 500);
  } finally {
    conn.release();
  }
});

// Admin Inventory Rule: create
app.post('/api/admin/inventory/rule', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const body = await c.req.json().catch(() => ({}));
    const menuItemId = String(body?.menuItemId || '').trim();
    const inventoryItemId = String(body?.inventoryItemId || '').trim();
    const consumeQty = parseFiniteNumber(body?.consumeQty);

    if (!menuItemId || !inventoryItemId) {
      return c.json({ error: 'menuItemId and inventoryItemId are required' }, 400);
    }
    if (consumeQty == null || consumeQty <= 0) {
      return c.json({ error: 'consumeQty must be a positive number' }, 400);
    }

    const [[menuRows], [inventoryRows]] = await Promise.all([
      pool.execute('SELECT id, nameEn, nameAr, category, available FROM items WHERE id = ? LIMIT 1', [menuItemId]),
      pool.execute('SELECT id, type, unit, active, nameEn, nameAr FROM inventory_items WHERE id = ? LIMIT 1', [inventoryItemId]),
    ]);
    const menuItem = Array.isArray(menuRows) && menuRows[0] ? menuRows[0] : null;
    const inventoryItem = Array.isArray(inventoryRows) && inventoryRows[0] ? inventoryRows[0] : null;
    if (!menuItem) return c.json({ error: 'Menu item not found' }, 404);
    if (!inventoryItem) return c.json({ error: 'Inventory item not found' }, 404);
    if (String(inventoryItem.unit || '') === 'pcs' && !isIntegerLike(consumeQty)) {
      return c.json({ error: 'consumeQty must be a whole number for pcs units' }, 400);
    }

    const now = Date.now();
    const [res] = await pool.execute(
      `INSERT INTO inventory_usage_rules (menuItemId, inventoryItemId, consumeQty, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [menuItemId, inventoryItemId, consumeQty, now, now]
    );

    return c.json({
      success: true,
      rule: mapInventoryRuleRow({
        id: Number(res.insertId || 0),
        menuItemId,
        inventoryItemId,
        consumeQty,
        menuNameEn: menuItem.nameEn,
        menuNameAr: menuItem.nameAr,
        menuCategory: menuItem.category,
        menuAvailable: menuItem.available,
        inventoryNameEn: inventoryItem.nameEn,
        inventoryNameAr: inventoryItem.nameAr,
        inventoryType: inventoryItem.type,
        inventoryUnit: inventoryItem.unit,
        inventoryActive: inventoryItem.active,
        createdAt: now,
        updatedAt: now,
      }),
    });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return c.json({ error: 'Usage rule already exists for this menu item and inventory item' }, 409);
    }
    console.error('Error creating inventory usage rule', e);
    return c.json({ error: 'Failed to create inventory usage rule' }, 500);
  }
});

// Admin Inventory Rule: update
app.put('/api/admin/inventory/rule/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = Number(c.req.param('id')) || 0;
    if (!id) return c.json({ error: 'Invalid rule id' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const [rows] = await pool.execute(
      'SELECT * FROM inventory_usage_rules WHERE id = ? LIMIT 1',
      [id]
    );
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!existing) return c.json({ error: 'Usage rule not found' }, 404);

    const menuItemId = body?.menuItemId != null ? String(body.menuItemId).trim() : String(existing.menuItemId);
    const inventoryItemId =
      body?.inventoryItemId != null ? String(body.inventoryItemId).trim() : String(existing.inventoryItemId);
    const consumeQty =
      body?.consumeQty != null ? parseFiniteNumber(body.consumeQty) : Number(existing.consumeQty);
    if (!menuItemId || !inventoryItemId) {
      return c.json({ error: 'menuItemId and inventoryItemId are required' }, 400);
    }
    if (consumeQty == null || consumeQty <= 0) {
      return c.json({ error: 'consumeQty must be a positive number' }, 400);
    }

    const [[menuRows], [inventoryRows]] = await Promise.all([
      pool.execute('SELECT id, nameEn, nameAr, category, available FROM items WHERE id = ? LIMIT 1', [menuItemId]),
      pool.execute('SELECT id, type, unit, active, nameEn, nameAr FROM inventory_items WHERE id = ? LIMIT 1', [inventoryItemId]),
    ]);
    const menuItem = Array.isArray(menuRows) && menuRows[0] ? menuRows[0] : null;
    const inventoryItem = Array.isArray(inventoryRows) && inventoryRows[0] ? inventoryRows[0] : null;
    if (!menuItem) return c.json({ error: 'Menu item not found' }, 404);
    if (!inventoryItem) return c.json({ error: 'Inventory item not found' }, 404);
    if (String(inventoryItem.unit || '') === 'pcs' && !isIntegerLike(consumeQty)) {
      return c.json({ error: 'consumeQty must be a whole number for pcs units' }, 400);
    }

    const now = Date.now();
    await pool.execute(
      `UPDATE inventory_usage_rules
       SET menuItemId = ?, inventoryItemId = ?, consumeQty = ?, updatedAt = ?
       WHERE id = ?`,
      [menuItemId, inventoryItemId, consumeQty, now, id]
    );

    return c.json({
      success: true,
      rule: mapInventoryRuleRow({
        id,
        menuItemId,
        inventoryItemId,
        consumeQty,
        menuNameEn: menuItem.nameEn,
        menuNameAr: menuItem.nameAr,
        menuCategory: menuItem.category,
        menuAvailable: menuItem.available,
        inventoryNameEn: inventoryItem.nameEn,
        inventoryNameAr: inventoryItem.nameAr,
        inventoryType: inventoryItem.type,
        inventoryUnit: inventoryItem.unit,
        inventoryActive: inventoryItem.active,
        createdAt: existing.createdAt,
        updatedAt: now,
      }),
    });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return c.json({ error: 'Usage rule already exists for this menu item and inventory item' }, 409);
    }
    console.error('Error updating inventory usage rule', e);
    return c.json({ error: 'Failed to update inventory usage rule' }, 500);
  }
});

// Admin Inventory Rule: delete
app.delete('/api/admin/inventory/rule/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = Number(c.req.param('id')) || 0;
    if (!id) return c.json({ error: 'Invalid rule id' }, 400);
    await pool.execute('DELETE FROM inventory_usage_rules WHERE id = ?', [id]);
    return c.json({ success: true });
  } catch (e) {
    console.error('Error deleting inventory usage rule', e);
    return c.json({ error: 'Failed to delete inventory usage rule' }, 500);
  }
});

// Admin settings: update open status + hours
app.post('/api/admin/settings/open-status', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const body = await c.req.json().catch(() => ({}));
    const isOpen = Boolean(body?.isOpen);
    const hoursEn = typeof body?.hoursEn === 'string' ? body.hoursEn.trim() : '';
    const hoursAr = typeof body?.hoursAr === 'string' ? body.hoursAr.trim() : '';
    const scheduleEnabled =
      typeof body?.scheduleEnabled === 'boolean' ? body.scheduleEnabled : null;
    const hoursStart = typeof body?.hoursStart === 'string' ? body.hoursStart.trim() : null;
    const hoursEnd = typeof body?.hoursEnd === 'string' ? body.hoursEnd.trim() : null;
    const timeZone = typeof body?.timeZone === 'string' ? body.timeZone.trim() : null;

    await setSetting('openStatus', isOpen ? 'true' : 'false');
    await setSetting('hoursEn', hoursEn || DEFAULT_HOURS_EN);
    await setSetting('hoursAr', hoursAr || DEFAULT_HOURS_AR);
    if (scheduleEnabled !== null) {
      await setSetting('scheduleEnabled', scheduleEnabled ? 'true' : 'false');
    }
    if (hoursStart !== null) {
      await setSetting('hoursStart', hoursStart || DEFAULT_HOURS_START);
    }
    if (hoursEnd !== null) {
      await setSetting('hoursEnd', hoursEnd || DEFAULT_HOURS_END);
    }
    if (timeZone !== null) {
      await setSetting('timeZone', timeZone || DEFAULT_TIMEZONE);
    }

    const effectiveScheduleEnabled =
      scheduleEnabled !== null
        ? scheduleEnabled
        : String(await getSetting('scheduleEnabled', DEFAULT_SCHEDULE_ENABLED ? 'true' : 'false'))
            .trim()
            .toLowerCase() === 'true';
    const effectiveHoursStart =
      hoursStart !== null ? hoursStart || DEFAULT_HOURS_START : await getSetting('hoursStart', DEFAULT_HOURS_START);
    const effectiveHoursEnd =
      hoursEnd !== null ? hoursEnd || DEFAULT_HOURS_END : await getSetting('hoursEnd', DEFAULT_HOURS_END);
    const effectiveTimeZone =
      timeZone !== null ? timeZone || DEFAULT_TIMEZONE : await getSetting('timeZone', DEFAULT_TIMEZONE);
    const computedOpen = effectiveScheduleEnabled
      ? isOpenForSchedule(new Date(), effectiveHoursStart, effectiveHoursEnd, effectiveTimeZone)
      : isOpen;
    const isOpenEffective = typeof computedOpen === 'boolean' ? computedOpen : isOpen;

    return c.json({
      success: true,
      isOpen: isOpenEffective,
      manualOpen: isOpen,
      schedule: {
        enabled: effectiveScheduleEnabled,
        start: effectiveHoursStart || DEFAULT_HOURS_START,
        end: effectiveHoursEnd || DEFAULT_HOURS_END,
        timeZone: effectiveTimeZone || DEFAULT_TIMEZONE,
      },
      hours: {
        en: hoursEn || DEFAULT_HOURS_EN,
        ar: hoursAr || DEFAULT_HOURS_AR,
      },
    });
  } catch (e) {
    console.error('Error updating open status', e);
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});
app.post('/api/admin/reset-menu', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const allowReset = (process.env.ALLOW_MENU_RESET || '').trim().toLowerCase() === 'true';
    if (!allowReset) {
      return c.json({ error: 'Menu reset disabled' }, 403);
    }
    const seedCategoryIds = ['espresso', 'v60', 'hot', 'cold', 'pastries'];
    const categories = [
      { id: 'espresso', nameEn: 'Espresso', nameAr: 'إسبريسو', order: 1 },
      {
        id: 'v60',
        nameEn: 'V60',
        nameAr: 'في60',
        order: 2,
        iconUrl: 'figma:asset/dc1a1f39b034b61aa298859970960cbc383307d6.png',
      },
      { id: 'hot', nameEn: 'Hot Drinks', nameAr: 'مشروبات ساخنة', order: 3 },
      { id: 'cold', nameEn: 'Cold Drinks', nameAr: 'مشروبات باردة', order: 4 },
      { id: 'pastries', nameEn: 'Sweets', nameAr: 'حلويات', order: 5 },
    ];

    // Upsert categories
    for (const cat of categories) {
      await pool.execute(
        'INSERT INTO categories (id, nameEn, nameAr, `order`, iconUrl) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nameEn=VALUES(nameEn), nameAr=VALUES(nameAr), `order`=VALUES(`order`), iconUrl=VALUES(iconUrl)',
        [cat.id, cat.nameEn, cat.nameAr, cat.order, cat.iconUrl || null]
      );
    }

    // Clean orphaned items
    const [existingItems] = await pool.execute('SELECT * FROM items');
    const validCategoryIds = seedCategoryIds;
    for (const item of existingItems) {
      if (!validCategoryIds.includes(item.category)) {
        await pool.execute('DELETE FROM items WHERE id = ?', [item.id]);
      }
    }

    // Seed baseline items
    const seedItems = [
      {
        id: 'dbl-espresso',
        nameEn: 'Double Espresso',
        nameAr: 'اسبرسو دبل',
        price: 12,
        category: 'espresso',
        description: 'Strong double shot espresso',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'americano',
        nameEn: 'Americano',
        nameAr: 'أمريكانو',
        price: 10,
        category: 'hot',
        description: 'Hot Americano coffee',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'cappuccino',
        nameEn: 'Cappuccino',
        nameAr: 'كابتشينو',
        price: 14,
        category: 'hot',
        description: 'Classic cappuccino',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'latte',
        nameEn: 'Latte',
        nameAr: 'لاتيه',
        price: 15,
        category: 'hot',
        description: 'Milk coffee latte',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'v60-basic',
        nameEn: 'V60',
        nameAr: 'في60',
        price: 16,
        category: 'v60',
        description: 'Hand-brewed V60',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'iced-latte',
        nameEn: 'Iced Latte',
        nameAr: 'ايس لاتيه',
        price: 16,
        category: 'cold',
        description: 'Refreshing iced latte',
        imageUrl: null,
        available: 1,
      },
      {
        id: 'cheesecake',
        nameEn: 'Cheesecake',
        nameAr: 'تشيز كيك',
        price: 18,
        category: 'pastries',
        description: 'Slice of cheesecake',
        imageUrl: null,
        available: 1,
      },
    ];

    for (const it of seedItems) {
      await pool.execute(
        'INSERT INTO items (id, nameEn, nameAr, price, category, description, imageUrl, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nameEn=VALUES(nameEn), nameAr=VALUES(nameAr), price=VALUES(price), category=VALUES(category), description=VALUES(description), imageUrl=VALUES(imageUrl), available=VALUES(available)',
        [
          it.id,
          it.nameEn,
          it.nameAr,
          it.price,
          it.category,
          it.description || null,
          it.imageUrl || null,
          it.available ? 1 : 0,
        ]
      );
    }

    const [finalCategories] = await pool.execute('SELECT * FROM categories ORDER BY `order` ASC');
    const [finalItems] = await pool.execute('SELECT * FROM items');

    return c.json({
      success: true,
      message: 'Menu cleaned and updated successfully',
      categories: finalCategories,
      items: finalItems,
    });
  } catch (e) {
    console.error('Error updating categories:', e);
    return c.json({ error: 'Failed to update categories' }, 500);
  }
});

async function cleanupSeedMenuItems(c) {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    if (!ALLOW_SEED_MENU_TOOLS) {
      return c.json({ error: 'Seed cleanup disabled' }, 403);
    }
    const seedItemIds = [
      'dbl-espresso',
      'americano',
      'cappuccino',
      'latte',
      'v60-basic',
      'iced-latte',
      'cheesecake',
    ];
    const placeholders = seedItemIds.map(() => '?').join(',');
    const [res] = await pool.execute(
      `DELETE FROM items WHERE id IN (${placeholders})`,
      seedItemIds
    );
    const deleted = Number(res?.affectedRows || 0);
    return c.json({ success: true, deleted });
  } catch (e) {
    console.error('Error cleaning seed items', e);
    return c.json({ error: 'Failed to clean seed items' }, 500);
  }
}

app.post('/api/admin/menu/cleanup-seed', cleanupSeedMenuItems);
app.post('/api/admin/menu/cleanup-demo', cleanupSeedMenuItems);

// Category CRUD
app.post('/api/admin/menu/category', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const body = await c.req.json();
  let { id, nameEn, nameAr, order, iconUrl } = body;
  if (!id) {
    // Generate a URL-friendly id from English name, fallback to random
    const base =
      (nameEn || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'cat';
    id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }
  await pool.execute(
    'INSERT INTO categories (id, nameEn, nameAr, `order`, iconUrl) VALUES (?, ?, ?, ?, ?)',
    [id, nameEn, nameAr, order ?? 0, iconUrl || null]
  );
  return c.json({
    success: true,
    category: { id, nameEn, nameAr, order: order ?? 0, iconUrl: iconUrl || null },
  });
});

app.put('/api/admin/menu/category/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { nameEn, nameAr, order, iconUrl } = body;
  await pool.execute('UPDATE categories SET nameEn=?, nameAr=?, `order`=?, iconUrl=? WHERE id=?', [
    nameEn,
    nameAr,
    order ?? 0,
    iconUrl || null,
    id,
  ]);
  return c.json({
    success: true,
    category: { id, nameEn, nameAr, order: order ?? 0, iconUrl: iconUrl || null },
  });
});

app.delete('/api/admin/menu/category/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = c.req.param('id');
  await pool.execute('DELETE FROM categories WHERE id=?', [id]);
  return c.json({ success: true });
});

// Item CRUD
app.post('/api/admin/menu/item', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const body = await c.req.json();
  let {
    id,
    nameEn,
    nameAr,
    price,
    category,
    description,
    descriptionEn,
    descriptionAr,
    imageUrl,
    available,
  } = body;
  const hasDescriptionEn = Object.prototype.hasOwnProperty.call(body, 'descriptionEn');
  const hasDescriptionAr = Object.prototype.hasOwnProperty.call(body, 'descriptionAr');
  descriptionEn = hasDescriptionEn ? descriptionEn || null : description || null;
  descriptionAr = hasDescriptionAr ? descriptionAr || null : description || null;
  description = descriptionEn || descriptionAr || null;
  if (!id) {
    const base =
      (nameEn || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'item';
    id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }
  await pool.execute(
    'INSERT INTO items (id, nameEn, nameAr, price, category, description, descriptionEn, descriptionAr, imageUrl, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, nameEn, nameAr, price, category, description, descriptionEn, descriptionAr, imageUrl || null, available ? 1 : 0]
  );
  return c.json({
    success: true,
    item: {
      id,
      nameEn,
      nameAr,
      price,
      category,
      description,
      descriptionEn,
      descriptionAr,
      imageUrl: imageUrl || null,
      available: !!available,
    },
  });
});

app.put('/api/admin/menu/item/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = c.req.param('id');
  const body = await c.req.json();
  let {
    nameEn,
    nameAr,
    price,
    category,
    description,
    descriptionEn,
    descriptionAr,
    imageUrl,
    available,
  } = body;
  const hasDescriptionEn = Object.prototype.hasOwnProperty.call(body, 'descriptionEn');
  const hasDescriptionAr = Object.prototype.hasOwnProperty.call(body, 'descriptionAr');
  descriptionEn = hasDescriptionEn ? descriptionEn || null : description || null;
  descriptionAr = hasDescriptionAr ? descriptionAr || null : description || null;
  description = descriptionEn || descriptionAr || null;
  const [existingRows] = await pool.execute('SELECT imageUrl FROM items WHERE id = ? LIMIT 1', [id]);
  const previousImageUrl = existingRows?.[0]?.imageUrl || null;
  await pool.execute(
    'UPDATE items SET nameEn=?, nameAr=?, price=?, category=?, description=?, descriptionEn=?, descriptionAr=?, imageUrl=?, available=? WHERE id=?',
    [nameEn, nameAr, price, category, description, descriptionEn, descriptionAr, imageUrl || null, available ? 1 : 0, id]
  );
  if (getUploadedFileName(previousImageUrl) !== getUploadedFileName(imageUrl)) {
    await deleteUploadedImage(previousImageUrl).catch((error) => {
      console.error('Failed to remove replaced menu image', error);
    });
  }
  return c.json({
    success: true,
    item: {
      id,
      nameEn,
      nameAr,
      price,
      category,
      description,
      descriptionEn,
      descriptionAr,
      imageUrl: imageUrl || null,
      available: !!available,
    },
  });
});

app.delete('/api/admin/menu/item/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = c.req.param('id');
  const [rows] = await pool.execute('SELECT imageUrl FROM items WHERE id = ? LIMIT 1', [id]);
  const imageUrl = rows?.[0]?.imageUrl || null;
  await pool.execute('DELETE FROM items WHERE id=?', [id]);
  await deleteUploadedImage(imageUrl).catch((error) => {
    console.error('Failed to remove deleted item image', error);
  });
  return c.json({ success: true });
});

// Orders
app.post('/api/orders/price-preview', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { items, redeemReward, discountCode, language } = body;
    if (!Array.isArray(items) || items.length === 0) {
      return c.json({ error: 'Order must contain at least one item' }, 400);
    }

    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    const effectiveLanguage = language === 'ar' ? 'ar' : 'en';
    const { canonicalItems } = await loadCanonicalOrderItems(items, effectiveLanguage);
    const pricing = await buildOrderPricing({
      canonicalItems,
      effectiveUserId: sessionUser?.id || null,
      effectiveLanguage,
      redeemReward: Boolean(redeemReward),
      discountCode,
      strictDiscountCode: false,
    });

    return c.json({
      success: true,
      pricing,
    });
  } catch (e) {
    const status = Number(e?.status) || 500;
    const payload = { error: e?.message || 'Failed to build order preview' };
    if (Array.isArray(e?.missing)) payload.missing = e.missing;
    if (Array.isArray(e?.unavailable)) payload.unavailable = e.unavailable;
    if (status >= 500) {
      console.error('Error building order preview', e);
    }
    return c.json(payload, status);
  }
});

// Core order-creation transaction, shared by the customer checkout endpoint and the
// cashier POS endpoint. Business-rule failures (bad items, low stock, busy queue) are
// thrown as `businessError` HTTP errors so respondOrderError() can pass their message
// and status straight through without logging them as server bugs.
async function createOrderInternal({
  items,
  paymentMethod,
  effectiveUserId,
  effectivePhoneNumber,
  redeemReward,
  discountCode,
  language,
  createdByUserId = null,
  customerName = null,
}) {
  if (!items || items.length === 0) {
    throw createHttpError(400, 'Order must contain at least one item', { businessError: true });
  }

  const effectiveLanguage = language === 'ar' ? 'ar' : 'en';
  const { normalizedItems, ids, placeholders, canonicalItems } = await loadCanonicalOrderItems(
    items,
    effectiveLanguage
  );
  const pricing = await buildOrderPricing({
    canonicalItems,
    effectiveUserId,
    effectiveLanguage,
    redeemReward: Boolean(redeemReward),
    discountCode,
    strictDiscountCode: true,
  });
  const effectiveItems = pricing.effectiveItems;
  const effectiveTotal = pricing.total;

  const dateKey = await getCurrentDateKey();
  const paymentMethodValue = paymentMethod || 'cash';

  let displayNumber = null;
  let orderNumber = null;
  let orderId = null;
  let createdAt = null;
  let inventoryWarnings = null;
  const lowStockNotifications = [];

  const conn = await pool.getConnection();
  let txOpen = false;
  let finalizationLockHeld = false;
  try {
    await conn.beginTransaction();
    txOpen = true;

    const [usageRows] =
      ids.length > 0
        ? await conn.execute(
            `SELECT menuItemId, inventoryItemId, consumeQty
             FROM inventory_usage_rules
             WHERE menuItemId IN (${placeholders})`,
            ids
          )
        : [[]];

    const rulesByMenuItemId = new Map();
    for (const row of Array.isArray(usageRows) ? usageRows : []) {
      const menuItemId = String(row.menuItemId || '');
      const inventoryItemId = String(row.inventoryItemId || '');
      const consumeQty = Number(row.consumeQty || 0);
      if (!menuItemId || !inventoryItemId || !Number.isFinite(consumeQty) || consumeQty <= 0) {
        continue;
      }
      const arr = rulesByMenuItemId.get(menuItemId) || [];
      arr.push({ inventoryItemId, consumeQty });
      rulesByMenuItemId.set(menuItemId, arr);
    }

    const seenUnlinked = new Set();
    const unlinkedMenuItemIds = [];
    const inventoryRequirements = new Map();
    for (const item of normalizedItems) {
      const rules = rulesByMenuItemId.get(item.id) || [];
      if (rules.length === 0) {
        if (!seenUnlinked.has(item.id)) {
          seenUnlinked.add(item.id);
          unlinkedMenuItemIds.push(item.id);
        }
        continue;
      }

      for (const rule of rules) {
        const requiredQty = roundInventoryQty(Number(rule.consumeQty) * Number(item.quantity || 0));
        if (!Number.isFinite(requiredQty) || requiredQty <= 0) continue;

        const existing = inventoryRequirements.get(rule.inventoryItemId);
        if (existing) {
          existing.requiredQty = roundInventoryQty(existing.requiredQty + requiredQty);
        } else {
          inventoryRequirements.set(rule.inventoryItemId, {
            inventoryItemId: rule.inventoryItemId,
            requiredQty,
          });
        }
      }
    }

    if (unlinkedMenuItemIds.length > 0) {
      inventoryWarnings = { unlinkedMenuItemIds };
    }

    const lockedInventoryById = new Map();
    if (inventoryRequirements.size > 0) {
      const inventoryIds = Array.from(inventoryRequirements.keys());
      const inventoryPlaceholders = inventoryIds.map(() => '?').join(',');
      const [inventoryRows] = await conn.execute(
        `SELECT id, nameEn, nameAr, unit, stockQty, lowStockThreshold, lowStockAlertSentAt, active
         FROM inventory_items
         WHERE id IN (${inventoryPlaceholders})
         FOR UPDATE`,
        inventoryIds
      );

      for (const row of Array.isArray(inventoryRows) ? inventoryRows : []) {
        lockedInventoryById.set(String(row.id), row);
      }

      const missingInventoryIds = inventoryIds.filter((id) => !lockedInventoryById.has(id));
      if (missingInventoryIds.length > 0) {
        await conn.rollback();
        txOpen = false;
        throw createHttpError(500, 'Inventory configuration is invalid', {
          businessError: true,
          missingInventoryIds,
          ...(inventoryWarnings ? { inventoryWarnings } : {}),
        });
      }

      const insufficient = [];
      for (const requirement of inventoryRequirements.values()) {
        const inventoryRow = lockedInventoryById.get(requirement.inventoryItemId);
        if (!inventoryRow) continue;
        const stockQty = Number(inventoryRow.stockQty || 0);
        const requiredQty = roundInventoryQty(requirement.requiredQty);
        const shortageQty = roundInventoryQty(requiredQty - stockQty);
        if (shortageQty > 0) {
          insufficient.push({
            inventoryItemId: String(inventoryRow.id),
            nameEn: String(inventoryRow.nameEn || ''),
            nameAr: String(inventoryRow.nameAr || ''),
            unit: String(inventoryRow.unit || ''),
            stockQty,
            requiredQty,
            shortageQty,
            active: Boolean(Number(inventoryRow.active)),
          });
        }
      }

      if (insufficient.length > 0) {
        await conn.rollback();
        txOpen = false;
        throw createHttpError(409, 'Insufficient inventory', {
          businessError: true,
          insufficient,
          ...(inventoryWarnings ? { inventoryWarnings } : {}),
        });
      }
    }

    if (!(await acquireNamedLock(conn, ORDER_FINALIZATION_LOCK_NAME, 15))) {
      await conn.rollback();
      txOpen = false;
      throw createHttpError(503, 'Order queue is busy. Please try again.', { businessError: true });
    }
    finalizationLockHeld = true;

    const [counterRes] = await conn.execute(
      'INSERT INTO order_counters (dateKey, currentNumber) VALUES (?, 1) ON DUPLICATE KEY UPDATE currentNumber = LAST_INSERT_ID(currentNumber + 1)',
      [dateKey]
    );
    displayNumber = Number(counterRes.insertId || 1);
    orderNumber = `${dateKey}-${String(displayNumber).padStart(3, '0')}`;
    orderId = `order:${orderNumber}`;
    createdAt = Date.now();

    await conn.execute(
      'INSERT INTO orders (id, orderNumber, displayNumber, dateKey, userId, phoneNumber, items, total, paymentMethod, status, completedAt, createdAt, discountCode, discountCodeGroup, discountAmount, createdByUserId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        orderId,
        orderNumber,
        displayNumber,
        dateKey,
        effectiveUserId,
        effectivePhoneNumber,
        JSON.stringify(effectiveItems),
        effectiveTotal,
        paymentMethodValue,
        'received',
        null,
        createdAt,
        pricing.discountCode,
        pricing.discountCodeGroup,
        pricing.discountCodeAmount > 0 ? pricing.discountCodeAmount : null,
        createdByUserId,
      ]
    );

    if (inventoryRequirements.size > 0) {
      for (const requirement of inventoryRequirements.values()) {
        const inventoryRow = lockedInventoryById.get(requirement.inventoryItemId);
        if (!inventoryRow) continue;
        const nextStockQty = roundInventoryQty(
          Number(inventoryRow.stockQty || 0) - Number(requirement.requiredQty || 0)
        );
        const lowStockThreshold = Number(inventoryRow.lowStockThreshold || 0);
        const existingLowStockAlertSentAt =
          inventoryRow.lowStockAlertSentAt != null ? Number(inventoryRow.lowStockAlertSentAt) : null;
        const nextLowStockAlertSentAt = shouldSendLowStockAlert({
          active: inventoryRow.active,
          stockQty: nextStockQty,
          lowStockThreshold,
          lowStockAlertSentAt: existingLowStockAlertSentAt,
        })
          ? createdAt
          : existingLowStockAlertSentAt;

        await conn.execute(
          'UPDATE inventory_items SET stockQty = ?, lowStockAlertSentAt = ?, updatedAt = ? WHERE id = ?',
          [nextStockQty, nextLowStockAlertSentAt, createdAt, requirement.inventoryItemId]
        );
        await conn.execute(
          `INSERT INTO inventory_movements
           (inventoryItemId, direction, qty, reason, orderId, note, createdByUserId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requirement.inventoryItemId,
            'out',
            roundInventoryQty(requirement.requiredQty),
            'sale',
            orderId,
            null,
            createdByUserId,
            createdAt,
          ]
        );

        inventoryRow.stockQty = nextStockQty;
        inventoryRow.lowStockAlertSentAt = nextLowStockAlertSentAt;

        if (nextLowStockAlertSentAt === createdAt && existingLowStockAlertSentAt !== nextLowStockAlertSentAt) {
          lowStockNotifications.push({
            id: String(inventoryRow.id),
            nameEn: String(inventoryRow.nameEn || ''),
            nameAr: String(inventoryRow.nameAr || ''),
            unit: String(inventoryRow.unit || ''),
            stockQty: nextStockQty,
            lowStockThreshold,
          });
        }
      }
    }

    // Enqueue print job (best-effort)
    try {
      await conn.execute(
        'INSERT INTO print_jobs (orderId, status, attempts, createdAt) VALUES (?, ?, ?, ?)',
        [orderId, 'pending', 0, createdAt]
      );
    } catch (e) {
      console.error('Failed to enqueue print job', e);
    }

    await conn.commit();
    txOpen = false;
  } catch (txError) {
    if (txOpen) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error('Failed to rollback order transaction', rollbackError);
      }
    }
    throw txError;
  } finally {
    if (finalizationLockHeld) {
      await releaseNamedLock(conn, ORDER_FINALIZATION_LOCK_NAME);
    }
    conn.release();
  }

  if (inventoryWarnings?.unlinkedMenuItemIds?.length) {
    console.warn('Order created with unlinked inventory items', {
      orderId,
      menuItemIds: inventoryWarnings.unlinkedMenuItemIds,
    });
  }

  // Loyalty: automatically enable after first order and accrue stamps
  if (effectiveUserId) {
    const nowTs = Date.now();
    await pool.execute(
      'INSERT INTO loyalty_accounts (userId, points, tier, enabled, enrollmentDate) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=1, enrollmentDate=IFNULL(enrollmentDate, VALUES(enrollmentDate))',
      [effectiveUserId, 0, 'basic', 1, nowTs]
    );
    // Accrue loyalty points (1 per order) — but only when this order isn't leaving an already-
    // earned reward unused. Otherwise a customer who skips redeeming on their free-cup order
    // would silently lose it and have to earn a whole new cycle before it's offered again.
    if (shouldAccrueLoyaltyPoint({
      rewardWasAvailable: pricing.loyaltyRewardAvailable,
      rewardWasRedeemed: pricing.rewardApplied,
    })) {
      await pool.execute(
        'UPDATE loyalty_accounts SET enabled=1, points = points + 1 WHERE userId = ?',
        [effectiveUserId]
      );
    } else {
      await pool.execute('UPDATE loyalty_accounts SET enabled=1 WHERE userId = ?', [effectiveUserId]);
    }
  }

  const orderSummary = {
    id: orderId,
    orderNumber,
    displayNumber,
    createdAt,
    userId: effectiveUserId,
    userName: customerName,
    phoneNumber: effectivePhoneNumber,
    items: effectiveItems,
    total: effectiveTotal,
    subtotalExclVat: pricing.subtotalExclVat,
    vatAmount: pricing.vatAmount,
    totalWithVat: pricing.totalWithVat,
    itemsTotal: pricing.itemsTotal,
    rewardType: pricing.rewardType,
    rewardDiscountAmount: pricing.rewardDiscountAmount,
    discountCode: pricing.discountCode,
    discountCodeName: pricing.discountCodeName,
    discountCodeGroup: pricing.discountCodeGroup,
    discountCodeAmount: pricing.discountCodeAmount,
    paymentMethod: paymentMethodValue,
    createdByUserId,
    status: 'received',
  };

  return { orderId, orderNumber, displayNumber, orderSummary, inventoryWarnings, lowStockNotifications };
}

function respondOrderError(c, e, logLabel) {
  const status = Number(e?.status) || 500;
  const silent = e?.businessError === true || (status >= 400 && status < 500);
  if (!silent) {
    console.error(logLabel, e);
    return c.json({ error: 'Failed to create order' }, 500);
  }
  const payload = { error: e?.message || 'Failed to create order' };
  if (Array.isArray(e?.missing)) payload.missing = e.missing;
  if (Array.isArray(e?.unavailable)) payload.unavailable = e.unavailable;
  if (Array.isArray(e?.missingInventoryIds)) payload.missingInventoryIds = e.missingInventoryIds;
  if (Array.isArray(e?.insufficient)) payload.insufficient = e.insufficient;
  if (e?.inventoryWarnings) payload.inventoryWarnings = e.inventoryWarnings;
  return c.json(payload, status);
}

function finalizeOrderResponse(result) {
  const { orderId, orderSummary, inventoryWarnings, lowStockNotifications } = result;
  const responsePayload = {
    success: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    displayNumber: result.displayNumber,
    order: orderSummary,
  };
  if (inventoryWarnings) {
    responsePayload.inventoryWarnings = inventoryWarnings;
  }

  sendNewOrderNotification(orderSummary).catch((notificationError) => {
    console.error('Failed to send new order notification', {
      orderId,
      error: notificationError?.message || notificationError,
    });
  });
  for (const item of lowStockNotifications) {
    sendInventoryLowStockNotification(item).catch((notificationError) => {
      console.error('Failed to send low stock notification after sale', {
        orderId,
        inventoryItemId: item.id,
        error: notificationError?.message || notificationError,
      });
    });
  }

  return responsePayload;
}

app.post('/api/orders/create', async (c) => {
  try {
    // Customer self-checkout only accepts orders during the configured working hours.
    // The cashier POS endpoint below deliberately skips this check — staff ring up
    // walk-in customers already in the shop regardless of the configured schedule.
    const openStatus = await getEffectiveOpenStatus();
    if (!openStatus.isOpen) {
      return c.json(
        {
          error: 'The shop is currently closed for orders.',
          shopClosed: true,
          hours: openStatus.hours,
          schedule: openStatus.schedule,
        },
        409
      );
    }

    const body = await c.req.json();
    const { items, paymentMethod, userId, phoneNumber, redeemReward, discountCode, language } =
      body;

    // Link order to session user if available
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    const effectiveUserId = sessionUser?.id || userId || null;
    const effectivePhoneNumber = sessionUser?.phoneNumber || phoneNumber || null;

    const result = await createOrderInternal({
      items,
      paymentMethod,
      effectiveUserId,
      effectivePhoneNumber,
      redeemReward,
      discountCode,
      language,
      customerName: sessionUser?.name || null,
    });

    return c.json(finalizeOrderResponse(result));
  } catch (e) {
    return respondOrderError(c, e, 'Error creating order');
  }
});

// Cashier POS: staff-entered walk-in order. Never trusts a client-supplied userId —
// an optional customer phone number is resolved/created server-side so a cashier can
// only enroll the phone they typed, not spoof an arbitrary existing account.
app.post('/api/cashier/orders/create', async (c) => {
  const unauthorized = await requireCashier(c);
  if (unauthorized) return unauthorized;
  try {
    const cashierUser = c.get('cashierUser');
    const body = await c.req.json();
    const { items, paymentMethod, customerPhoneNumber, language } = body;

    let effectiveUserId = null;
    let customerName = null;
    const rawPhone = String(customerPhoneNumber || '').trim();
    let effectivePhoneNumber = null;
    if (rawPhone) {
      const normalizedPhone = normalizeKsaPhone(rawPhone);
      if (!normalizedPhone) {
        return c.json({ error: 'Invalid customer phone number' }, 400);
      }
      effectivePhoneNumber = normalizedPhone;
      const customerId = `user:${normalizedPhone}`;
      const now = Date.now();
      const [existingRows] = await pool.execute('SELECT name FROM users WHERE id = ? LIMIT 1', [
        customerId,
      ]);
      const existingCustomer = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
      customerName = String(existingCustomer?.name || '').trim() || 'Guest';
      await pool.execute(
        `INSERT INTO users (id, phoneNumber, name, email, language, role, phoneVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, NULL, NULL, 'user', 0, ?, ?)
         ON DUPLICATE KEY UPDATE updatedAt = VALUES(updatedAt)`,
        [customerId, normalizedPhone, customerName, now, now]
      );
      effectiveUserId = customerId;
    }

    const result = await createOrderInternal({
      items,
      paymentMethod,
      effectiveUserId,
      effectivePhoneNumber,
      redeemReward: false,
      discountCode: null,
      language,
      createdByUserId: cashierUser?.id || null,
      customerName,
    });

    return c.json(finalizeOrderResponse(result));
  } catch (e) {
    return respondOrderError(c, e, 'Error creating cashier order');
  }
});

// Print jobs: claim next pending job (for print bridge)
printApi.get('/ping', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  return c.json({ success: true });
});

printApi.post('/jobs/claim', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const staleBefore = Date.now() - PRINT_JOB_STALE_MS;
    const retryBefore = Date.now() - PRINT_JOB_RETRY_FAILED_MS;
    const [rows] = await conn.execute(
      `SELECT * FROM print_jobs
       WHERE attempts < ?
         AND (
           status = ?
           OR (status = ? AND claimedAt IS NOT NULL AND claimedAt < ?)
           OR (status = ? AND (claimedAt IS NULL OR claimedAt < ?))
         )
       ORDER BY (status = 'pending') DESC, createdAt ASC
       LIMIT 1
       FOR UPDATE`,
      [PRINT_JOB_MAX_ATTEMPTS, 'pending', 'printing', staleBefore, 'failed', retryBefore]
    );
    let job = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!job && PRINT_JOB_BACKFILL_MS > 0) {
      const backfillAfter = Date.now() - PRINT_JOB_BACKFILL_MS;
      const [missingRows] = await conn.execute(
        `SELECT o.id AS orderId, o.createdAt
         FROM orders o
         LEFT JOIN print_jobs pj ON pj.orderId = o.id
         WHERE pj.id IS NULL AND o.createdAt >= ?
         ORDER BY o.createdAt ASC
         LIMIT 1
         FOR UPDATE`,
        [backfillAfter]
      );
      const missing = Array.isArray(missingRows) && missingRows[0] ? missingRows[0] : null;
      if (missing?.orderId) {
        const createdAt = Number(missing.createdAt || Date.now());
        const [insertRes] = await conn.execute(
          'INSERT INTO print_jobs (orderId, status, attempts, createdAt) VALUES (?, ?, ?, ?)',
          [missing.orderId, 'pending', 0, createdAt]
        );
        job = {
          id: Number(insertRes.insertId),
          orderId: String(missing.orderId),
          status: 'pending',
          attempts: 0,
          createdAt,
        };
      }
    }
    if (!job) {
      await conn.commit();
      return c.json({ success: true, job: null });
    }

    const now = Date.now();
    const claimToken = generatePrintClaimToken();
    await conn.execute(
      'UPDATE print_jobs SET status = ?, claimedAt = ?, claimToken = ?, attempts = attempts + 1 WHERE id = ?',
      ['printing', now, claimToken, job.id]
    );
    await conn.commit();

    const [orderRows] = await pool.execute(
      `SELECT o.*, u.name AS userName
       FROM orders o
       LEFT JOIN users u ON u.id = o.userId
       WHERE o.id = ? LIMIT 1`,
      [job.orderId]
    );
    const orderRow = Array.isArray(orderRows) && orderRows[0] ? orderRows[0] : null;
    if (!orderRow) {
      await pool.execute(
        'UPDATE print_jobs SET status = ?, lastError = ?, printedAt = NULL, claimedAt = NULL, claimToken = NULL WHERE id = ?',
        ['failed', 'Order not found', job.id]
      );
      return c.json({ success: false, error: 'Order not found' }, 404);
    }

    return c.json({
      success: true,
      job: {
        id: Number(job.id),
        orderId: String(job.orderId),
        claimToken,
        status: 'printing',
        attempts: Number(job.attempts || 0) + 1,
        claimedAt: now,
        createdAt: Number(job.createdAt || now),
        order: mapOrderRow(orderRow),
      },
    });
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error('Failed to rollback print job claim', rollbackError);
    }
    console.error('Failed to claim print job', e);
    return c.json({ error: 'Failed to claim print job' }, 500);
  } finally {
    conn.release();
  }
});

// Print jobs: acknowledge success
printApi.post('/jobs/:id/ack', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  const id = Number(c.req.param('id')) || 0;
  if (!id) return c.json({ error: 'Invalid job id' }, 400);

  try {
    const body = await c.req.json().catch(() => ({}));
    const claimToken = typeof body?.claimToken === 'string' ? body.claimToken.trim() : '';
    if (!claimToken) return c.json({ error: 'claimToken is required' }, 400);
    const [result] = await pool.execute(
      'UPDATE print_jobs SET status = ?, printedAt = ?, lastError = NULL, claimToken = NULL WHERE id = ? AND status = ? AND claimToken = ?',
      ['printed', Date.now(), id, 'printing', claimToken]
    );
    if (!result?.affectedRows) {
      return c.json({ error: 'Invalid or expired claim token' }, 409);
    }
    return c.json({ success: true });
  } catch (e) {
    console.error('Failed to ack print job', e);
    return c.json({ error: 'Failed to update print job' }, 500);
  }
});

// Print jobs: mark failure
printApi.post('/jobs/:id/fail', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  const id = Number(c.req.param('id')) || 0;
  if (!id) return c.json({ error: 'Invalid job id' }, 400);

  try {
    const body = await c.req.json().catch(() => ({}));
    const message = typeof body?.error === 'string' ? body.error : 'Print failed';
    const claimToken = typeof body?.claimToken === 'string' ? body.claimToken.trim() : '';
    if (!claimToken) return c.json({ error: 'claimToken is required' }, 400);
    const [result] = await pool.execute(
      'UPDATE print_jobs SET status = ?, lastError = ?, printedAt = NULL, claimedAt = NULL, claimToken = NULL WHERE id = ? AND status = ? AND claimToken = ?',
      ['failed', message, id, 'printing', claimToken]
    );
    if (!result?.affectedRows) {
      return c.json({ error: 'Invalid or expired claim token' }, 409);
    }
    return c.json({ success: true });
  } catch (e) {
    console.error('Failed to mark print job failed', e);
    return c.json({ error: 'Failed to update print job' }, 500);
  }
});

app.route('/api/print', printApi);
app.route('/api/api/print', printApi);

// Customer Orders: fetch a single order for tracking
app.get('/api/orders/:id', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);

    const raw = decodeURIComponent(String(c.req.param('id') || '')).trim();
    if (raw.toLowerCase() === 'my') {
      // Hono matches `/api/orders/:id` before the later `/api/orders/my` route.
      // Serve the "my orders" payload here to avoid a route-order regression.
      const limit = Math.min(Math.max(Number(c.req.query('limit') || 20) || 20, 1), 200);
      const safeLimit = Math.trunc(limit);
      const [rows] = await pool.execute(
        `SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC LIMIT ${safeLimit}`,
        [sessionUser.id]
      );
      const orders = (Array.isArray(rows) ? rows : []).map(mapOrderRow);
      return c.json({ success: true, orders });
    }
    const orderNumber = raw.startsWith('order:') ? raw.slice('order:'.length) : raw;
    if (!/^\d{8}-\d{3}$/.test(orderNumber)) {
      return c.json({ error: 'Invalid order id' }, 400);
    }
    const orderId = `order:${orderNumber}`;

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId]);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return c.json({ error: 'Order not found' }, 404);

    const isAdmin = sessionUser?.role === 'admin';
    const allowed =
      isAdmin ||
      (row.userId && String(row.userId) === String(sessionUser.id)) ||
      (row.phoneNumber && String(row.phoneNumber) === String(sessionUser.phoneNumber));
    if (!allowed) return c.json({ error: 'Forbidden' }, 403);

    return c.json({ success: true, order: mapOrderRow(row) });
  } catch (e) {
    console.error('Error fetching order', e);
    return c.json({ error: 'Failed to fetch order' }, 500);
  }
});

// Customer Orders: list recent orders for the signed-in user
app.get('/api/orders/my', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);

    const limit = Math.min(Math.max(Number(c.req.query('limit') || 20) || 20, 1), 200);
    const safeLimit = Math.trunc(limit);
    const [rows] = await pool.execute(
      `SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC LIMIT ${safeLimit}`,
      [sessionUser.id]
    );
    const orders = (Array.isArray(rows) ? rows : []).map(mapOrderRow);
    return c.json({ success: true, orders });
  } catch (e) {
    console.error('Error fetching my orders', e);
    return c.json({ error: 'Failed to fetch orders' }, 500);
  }
});

// Admin Customers: aggregate from users + orders and include loyalty
app.get('/api/admin/customers', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(`
      SELECT 
        COALESCE(u.id, CONCAT('phone:', COALESCE(o.phoneNumber, '')), CONCAT('user:', COALESCE(o.userId, ''))) AS customerKey,
        COALESCE(u.phoneNumber, o.phoneNumber) AS phoneNumber,
        MAX(u.name) AS name,
        MAX(u.id) AS userId,
        COUNT(o.id) AS totalOrders,
        COALESCE(SUM(o.total), 0) AS totalSpent,
        MAX(o.createdAt) AS lastOrderAt,
        SUBSTRING_INDEX(GROUP_CONCAT(o.orderNumber ORDER BY o.createdAt DESC SEPARATOR ','), ',', 1) AS lastOrderNumber,
        MAX(la.enabled) AS loyaltyEnabled,
        MAX(la.tier) AS loyaltyTier,
        MAX(la.points) AS loyaltyPoints
      FROM orders o
      LEFT JOIN users u ON (u.phoneNumber = o.phoneNumber OR u.id = o.userId)
      LEFT JOIN loyalty_accounts la ON la.userId = u.id
      GROUP BY customerKey, phoneNumber
      ORDER BY lastOrderAt DESC
    `);

    const customers = rows.map((row) => ({
      customerKey: row.customerKey || null,
      phoneNumber: row.phoneNumber || null,
      name: row.name || null,
      userId: row.userId || null,
      totalOrders: Number(row.totalOrders || 0),
      totalSpent: Number(row.totalSpent || 0),
      lastOrderAt: row.lastOrderAt ? Number(row.lastOrderAt) : null,
      lastOrderNumber: row.lastOrderNumber || null,
      loyaltyEnabled: row.loyaltyEnabled != null ? Boolean(Number(row.loyaltyEnabled)) : false,
      loyaltyTier: row.loyaltyTier || null,
      loyaltyPoints: row.loyaltyPoints != null ? Number(row.loyaltyPoints) : 0,
    }));

    return c.json({ success: true, customers });
  } catch (e) {
    console.error('Error aggregating customers', e);
    return c.json({ error: 'Failed to load customers' }, 500);
  }
});

// WhatsApp broadcast: distinct customer phone numbers eligible to receive a broadcast — every
// phone number that has ever placed an order or holds a customer account. No opt-in filtering
// (by explicit choice); if that changes later, this is the one place to add the filter.
async function getBroadcastRecipientPhoneNumbers(db = pool) {
  const [rows] = await db.execute(`
    SELECT DISTINCT phoneNumber FROM (
      SELECT phoneNumber FROM orders WHERE phoneNumber IS NOT NULL AND phoneNumber <> ''
      UNION
      SELECT phoneNumber FROM users WHERE role = 'user' AND phoneNumber IS NOT NULL AND phoneNumber <> ''
    ) AS recipients
  `);
  return (Array.isArray(rows) ? rows : []).map((row) => String(row.phoneNumber)).filter(Boolean);
}

app.get('/api/admin/broadcast/whatsapp/recipient-count', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const phones = await getBroadcastRecipientPhoneNumbers();
    return c.json({ success: true, count: phones.length, configured: WHATSAPP_MARKETING_CONFIGURED });
  } catch (e) {
    console.error('Error counting broadcast recipients', e);
    return c.json({ error: 'Failed to count recipients' }, 500);
  }
});

app.get('/api/admin/broadcast/whatsapp', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(
      `SELECT id, messageEn, messageAr, status, recipientCount, sentCount, failedCount,
              failedNumbers, createdByUserId, createdAt, completedAt
       FROM whatsapp_broadcasts ORDER BY createdAt DESC LIMIT 50`
    );
    const broadcasts = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      messageEn: row.messageEn,
      messageAr: row.messageAr,
      status: row.status,
      recipientCount: Number(row.recipientCount || 0),
      sentCount: Number(row.sentCount || 0),
      failedCount: Number(row.failedCount || 0),
      failedNumbers: row.failedNumbers || [],
      createdAt: Number(row.createdAt),
      completedAt: row.completedAt != null ? Number(row.completedAt) : null,
    }));
    return c.json({ success: true, broadcasts, configured: WHATSAPP_MARKETING_CONFIGURED });
  } catch (e) {
    console.error('Error loading broadcasts', e);
    return c.json({ error: 'Failed to load broadcasts' }, 500);
  }
});

// Runs detached from the request — a broadcast to a real customer list can take minutes
// (throttled to avoid tripping WhatsApp's rate limits), far longer than an HTTP request should
// block for. The admin UI polls GET /api/admin/broadcast/whatsapp/:id for live progress.
async function runWhatsAppBroadcast(broadcastId, recipients, messageEn, messageAr) {
  let sentCount = 0;
  const failedNumbers = [];

  await pool.execute("UPDATE whatsapp_broadcasts SET status = 'running' WHERE id = ?", [
    broadcastId,
  ]);

  for (const recipient of recipients) {
    try {
      const language = recipient.language === 'en' ? 'en' : 'ar';
      const bodyText = language === 'en' && messageEn ? messageEn : messageAr || messageEn;
      await sendWhatsAppMarketingMessage({
        phoneNumber: recipient.phoneNumber,
        bodyText,
        language,
      });
      sentCount += 1;
    } catch (error) {
      failedNumbers.push(recipient.phoneNumber);
      console.error('WhatsApp broadcast send failed for', recipient.phoneNumber, error?.message || error);
    }

    await pool.execute(
      'UPDATE whatsapp_broadcasts SET sentCount = ?, failedCount = ?, failedNumbers = ? WHERE id = ?',
      [sentCount, failedNumbers.length, JSON.stringify(failedNumbers), broadcastId]
    );

    // Stay well under WhatsApp's per-second throughput limits — this is a small customer list,
    // not a high-volume sender, so there is no need to rush.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  await pool.execute(
    "UPDATE whatsapp_broadcasts SET status = 'completed', completedAt = ? WHERE id = ?",
    [Date.now(), broadcastId]
  );
}

app.post('/api/admin/broadcast/whatsapp', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  if (!WHATSAPP_MARKETING_CONFIGURED) {
    return c.json({ error: 'WhatsApp marketing template is not configured' }, 503);
  }
  try {
    const adminUser = await getAdminSessionUserFromRequest(c);
    const { messageEn, messageAr } = await c.req.json();
    const trimmedEn = String(messageEn || '').trim();
    const trimmedAr = String(messageAr || '').trim();
    if (!trimmedEn && !trimmedAr) {
      return c.json({ error: 'Enter a message in at least one language' }, 400);
    }

    const [phoneRows, userRows] = await Promise.all([
      getBroadcastRecipientPhoneNumbers(),
      pool.execute("SELECT phoneNumber, language FROM users WHERE role = 'user'"),
    ]);
    const languageByPhone = new Map(
      (Array.isArray(userRows[0]) ? userRows[0] : []).map((row) => [
        String(row.phoneNumber),
        row.language || null,
      ])
    );
    const recipients = phoneRows.map((phoneNumber) => ({
      phoneNumber,
      language: languageByPhone.get(phoneNumber) || null,
    }));

    if (recipients.length === 0) {
      return c.json({ error: 'No customers to send to' }, 400);
    }

    const id = `broadcast:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    await pool.execute(
      `INSERT INTO whatsapp_broadcasts
       (id, messageEn, messageAr, status, recipientCount, sentCount, failedCount, createdByUserId, createdAt)
       VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?)`,
      [id, trimmedEn || null, trimmedAr || null, recipients.length, adminUser?.id || null, now]
    );

    runWhatsAppBroadcast(id, recipients, trimmedEn, trimmedAr).catch((error) => {
      console.error('WhatsApp broadcast run failed', id, error);
      pool
        .execute("UPDATE whatsapp_broadcasts SET status = 'failed', completedAt = ? WHERE id = ?", [
          Date.now(),
          id,
        ])
        .catch(() => {});
    });

    return c.json({ success: true, broadcastId: id, recipientCount: recipients.length });
  } catch (e) {
    console.error('Error starting WhatsApp broadcast', e);
    return c.json({ error: 'Failed to start broadcast' }, 500);
  }
});

app.post('/api/admin/broadcast/whatsapp/test', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  if (!WHATSAPP_MARKETING_CONFIGURED) {
    return c.json({ error: 'WhatsApp marketing template is not configured' }, 503);
  }
  try {
    const { phoneNumber, messageEn, messageAr, language } = await c.req.json();
    const normalizedPhone = normalizeKsaPhone(phoneNumber);
    if (!normalizedPhone) return c.json({ error: 'Invalid phone number' }, 400);
    const effectiveLanguage = language === 'en' ? 'en' : 'ar';
    const bodyText =
      effectiveLanguage === 'en' && messageEn ? messageEn : messageAr || messageEn;
    if (!String(bodyText || '').trim()) {
      return c.json({ error: 'Enter a message in at least one language' }, 400);
    }
    await sendWhatsAppMarketingMessage({
      phoneNumber: normalizedPhone,
      bodyText: String(bodyText).trim(),
      language: effectiveLanguage,
    });
    return c.json({ success: true });
  } catch (e) {
    console.error('Error sending WhatsApp broadcast test message', e);
    return c.json({ error: e?.message || 'Failed to send test message' }, 500);
  }
});

// Admin: manage cashier/staff accounts
app.get('/api/admin/staff', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(
      `SELECT id, phoneNumber, name, active, createdAt, updatedAt
       FROM users WHERE role = 'cashier' ORDER BY createdAt DESC`
    );
    const staff = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      phoneNumber: row.phoneNumber,
      name: row.name,
      active: Boolean(Number(row.active)),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
    return c.json({ success: true, staff });
  } catch (e) {
    console.error('Error loading staff accounts', e);
    return c.json({ error: 'Failed to load staff accounts' }, 500);
  }
});

// Cashier accounts sign in the exact same way admin does: phone + SMS OTP
// (see /api/auth/verify-otp). Creating a staff account here just grants that phone
// number the 'cashier' role — there is no separate password/PIN to set.
app.post('/api/admin/staff', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const adminUser = await getAdminSessionUserFromRequest(c);
    const { name, phoneNumber, convertExisting } = await c.req.json();
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return c.json({ error: 'Name is required' }, 400);

    const normalizedPhone = normalizeKsaPhone(phoneNumber);
    if (!normalizedPhone) return c.json({ error: 'Invalid phone number' }, 400);

    const id = `user:${normalizedPhone}`;
    const [existingRows] = await pool.execute(
      'SELECT role, name FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
    const now = Date.now();

    if (existing) {
      if (existing.role === 'admin') {
        return c.json({ error: 'This phone number belongs to an admin account' }, 409);
      }
      if (existing.role === 'cashier') {
        return c.json({ error: 'This phone number is already a cashier account' }, 409);
      }
      // existing.role === 'user' (a customer/guest account) — refuse unless the admin has
      // explicitly confirmed converting it, since it may carry real order/loyalty history.
      if (!convertExisting) {
        return c.json(
          {
            error: 'A customer account already exists with this phone number',
            existingRole: existing.role,
            existingName: existing.name || null,
          },
          409
        );
      }

      await pool.execute(
        `UPDATE users SET role = 'cashier', name = ?, active = 1, createdBy = ?, updatedAt = ? WHERE id = ?`,
        [trimmedName, adminUser?.id || null, now, id]
      );
      return c.json({
        success: true,
        staff: { id, phoneNumber: normalizedPhone, name: trimmedName, active: true, createdAt: now, updatedAt: now },
        converted: true,
      });
    }

    await pool.execute(
      `INSERT INTO users
       (id, phoneNumber, name, email, language, role, active, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, NULL, 'cashier', 1, ?, ?, ?)`,
      [id, normalizedPhone, trimmedName, adminUser?.id || null, now, now]
    );

    return c.json({
      success: true,
      staff: { id, phoneNumber: normalizedPhone, name: trimmedName, active: true, createdAt: now, updatedAt: now },
    });
  } catch (e) {
    console.error('Error creating staff account', e);
    return c.json({ error: 'Failed to create staff account' }, 500);
  }
});

app.put('/api/admin/staff/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = c.req.param('id');
    const [rows] = await pool.execute("SELECT * FROM users WHERE id = ? AND role = 'cashier' LIMIT 1", [
      id,
    ]);
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!existing) return c.json({ error: 'Staff account not found' }, 404);

    const { name, active } = await c.req.json();
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return c.json({ error: 'Name cannot be empty' }, 400);
      updates.push('name = ?');
      params.push(trimmedName);
    }
    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No changes provided' }, 400);
    }

    const now = Date.now();
    updates.push('updatedAt = ?');
    params.push(now);
    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    // Deactivating a cashier should also end any session they're currently using.
    if (active === false) {
      await pool.execute('DELETE FROM sessions WHERE userId = ?', [id]);
      for (const [token, entry] of sessions.entries()) {
        if (entry?.user?.id === id) sessions.delete(token);
      }
    }

    const [updatedRows] = await pool.execute(
      'SELECT id, phoneNumber, name, active, createdAt, updatedAt FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    const updated = updatedRows[0];
    return c.json({
      success: true,
      staff: {
        id: updated.id,
        phoneNumber: updated.phoneNumber,
        name: updated.name,
        active: Boolean(Number(updated.active)),
        createdAt: Number(updated.createdAt),
        updatedAt: Number(updated.updatedAt),
      },
    });
  } catch (e) {
    console.error('Error updating staff account', e);
    return c.json({ error: 'Failed to update staff account' }, 500);
  }
});

// Admin: manage other admin accounts. Restricted to the primary admin (ADMIN_PHONE) via
// requireRootAdmin — any admin can view/edit orders, menu, inventory, etc., but only the
// primary admin can grant or revoke admin access itself.
app.get('/api/admin/admins', async (c) => {
  const unauthorized = await requireRootAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(
      `SELECT id, phoneNumber, name, active, createdAt, updatedAt
       FROM users WHERE role = 'admin' ORDER BY createdAt ASC`
    );
    const admins = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.id,
      phoneNumber: row.phoneNumber,
      name: row.name,
      active: Boolean(Number(row.active)),
      isRootAdmin: String(row.phoneNumber) === ADMIN_PHONE_NORMALIZED,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
    return c.json({ success: true, admins });
  } catch (e) {
    console.error('Error loading admin accounts', e);
    return c.json({ error: 'Failed to load admin accounts' }, 500);
  }
});

app.post('/api/admin/admins', async (c) => {
  const unauthorized = await requireRootAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const adminUser = await getAdminSessionUserFromRequest(c);
    const { name, phoneNumber, convertExisting } = await c.req.json();
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return c.json({ error: 'Name is required' }, 400);

    const normalizedPhone = normalizeKsaPhone(phoneNumber);
    if (!normalizedPhone) return c.json({ error: 'Invalid phone number' }, 400);

    const id = `user:${normalizedPhone}`;
    const [existingRows] = await pool.execute(
      'SELECT role, name FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
    const now = Date.now();

    if (existing) {
      if (existing.role === 'admin') {
        return c.json({ error: 'This phone number is already an admin account' }, 409);
      }
      // existing.role is 'user' or 'cashier' — refuse unless explicitly confirmed, since it may
      // carry real order/loyalty history (or, for a cashier, an active staff account).
      if (!convertExisting) {
        return c.json(
          {
            error: `An existing ${existing.role} account already uses this phone number`,
            existingRole: existing.role,
            existingName: existing.name || null,
          },
          409
        );
      }

      await pool.execute(
        `UPDATE users SET role = 'admin', name = ?, active = 1, updatedAt = ? WHERE id = ?`,
        [trimmedName, now, id]
      );
      return c.json({
        success: true,
        admin: {
          id,
          phoneNumber: normalizedPhone,
          name: trimmedName,
          active: true,
          isRootAdmin: false,
          createdAt: now,
          updatedAt: now,
        },
        converted: true,
      });
    }

    await pool.execute(
      `INSERT INTO users
       (id, phoneNumber, name, email, language, role, active, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, NULL, 'admin', 1, ?, ?, ?)`,
      [id, normalizedPhone, trimmedName, adminUser?.id || null, now, now]
    );

    return c.json({
      success: true,
      admin: {
        id,
        phoneNumber: normalizedPhone,
        name: trimmedName,
        active: true,
        isRootAdmin: false,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (e) {
    console.error('Error creating admin account', e);
    return c.json({ error: 'Failed to create admin account' }, 500);
  }
});

app.put('/api/admin/admins/:id', async (c) => {
  const unauthorized = await requireRootAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = c.req.param('id');
    if (id === `user:${ADMIN_PHONE_NORMALIZED}`) {
      return c.json({ error: 'The primary admin account cannot be edited here' }, 403);
    }

    const [rows] = await pool.execute("SELECT * FROM users WHERE id = ? AND role = 'admin' LIMIT 1", [
      id,
    ]);
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!existing) return c.json({ error: 'Admin account not found' }, 404);

    const { name, active } = await c.req.json();
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return c.json({ error: 'Name cannot be empty' }, 400);
      updates.push('name = ?');
      params.push(trimmedName);
    }
    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No changes provided' }, 400);
    }

    const now = Date.now();
    updates.push('updatedAt = ?');
    params.push(now);
    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    // Deactivating an admin should also end any session they're currently using.
    if (active === false) {
      await pool.execute('DELETE FROM sessions WHERE userId = ?', [id]);
      for (const [token, entry] of sessions.entries()) {
        if (entry?.user?.id === id) sessions.delete(token);
      }
    }

    const [updatedRows] = await pool.execute(
      'SELECT id, phoneNumber, name, active, createdAt, updatedAt FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    const updated = updatedRows[0];
    return c.json({
      success: true,
      admin: {
        id: updated.id,
        phoneNumber: updated.phoneNumber,
        name: updated.name,
        active: Boolean(Number(updated.active)),
        isRootAdmin: false,
        createdAt: Number(updated.createdAt),
        updatedAt: Number(updated.updatedAt),
      },
    });
  } catch (e) {
    console.error('Error updating admin account', e);
    return c.json({ error: 'Failed to update admin account' }, 500);
  }
});

// Admin Orders: active list
function mapOrderRow(row) {
  const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
  const total = Number(row.total);
  const vatAmount = roundMoney(total * (ORDER_VAT_RATE / (1 + ORDER_VAT_RATE)));
  const subtotalExclVat = roundMoney(total - vatAmount);
  const totalWithVat = total;
  return {
    id: row.id,
    userId: row.userId || null,
    userName: row.userName || null,
    phoneNumber: row.phoneNumber || null,
    items,
    total,
    subtotalExclVat,
    vatAmount,
    totalWithVat,
    discountCode: row.discountCode || null,
    discountCodeGroup: row.discountCodeGroup || null,
    discountAmount: row.discountAmount != null ? Number(row.discountAmount) : 0,
    status: row.completedAt ? 'completed' : 'received',
    paymentMethod: row.paymentMethod,
    orderNumber: row.orderNumber,
    displayNumber: row.displayNumber,
    createdAt: Number(row.createdAt),
    completedAt: row.completedAt != null ? Number(row.completedAt) : null,
  };
}

app.get('/api/admin/orders/active', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM orders WHERE completedAt IS NULL ORDER BY createdAt DESC'
    );
    const orders = rows.map(mapOrderRow);
    return c.json({ success: true, orders });
  } catch (e) {
    console.error('Error fetching active orders', e);
    return c.json({ error: 'Failed to fetch active orders' }, 500);
  }
});

// Admin Orders: history list (completed)
app.get('/api/admin/orders/history', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  try {
    const q = (c.req.query('q') || '').trim();
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 100) || 100, 1), 500);
    const offset = Math.max(Number(c.req.query('offset') || 0) || 0, 0);
    const from = Number(c.req.query('from') || 0) || 0;
    const to = Number(c.req.query('to') || 0) || 0;
    const dateKey = (c.req.query('dateKey') || '').trim();
    const status = (c.req.query('status') || 'all').trim();

    const where = [];
    const params = [];

    if (status !== 'all') {
      if (status === 'completed') {
        where.push('completedAt IS NOT NULL');
      } else if (status === 'received') {
        where.push('completedAt IS NULL');
      }
    }

    if (dateKey) {
      if (!/^\d{8}$/.test(dateKey)) return c.json({ error: 'Invalid dateKey' }, 400);
      where.push('dateKey = ?');
      params.push(dateKey);
    } else {
      if (from > 0) {
        where.push('createdAt >= ?');
        params.push(from);
      }
      if (to > 0) {
        where.push('createdAt <= ?');
        params.push(to);
      }
    }
    if (q) {
      where.push('(orderNumber LIKE ? OR COALESCE(phoneNumber, "") LIKE ? OR id LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeLimit = Math.trunc(limit);
    const safeOffset = Math.trunc(offset);
    const sql = `SELECT * FROM orders ${whereSql} ORDER BY createdAt DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.execute(sql, params);
    const orders = rows.map(mapOrderRow);
    return c.json({ success: true, orders, limit, offset, status });
  } catch (e) {
    console.error('Error fetching orders history', e);
    return c.json({ error: 'Failed to fetch order history' }, 500);
  }
});

// Admin Orders: history grouped by day (dateKey)
app.get('/api/admin/orders/history/days', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  try {
    const q = (c.req.query('q') || '').trim();
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 60) || 60, 1), 3650);
    const offset = Math.max(Number(c.req.query('offset') || 0) || 0, 0);
    const from = Number(c.req.query('from') || 0) || 0;
    const to = Number(c.req.query('to') || 0) || 0;
    const dateKey = (c.req.query('dateKey') || '').trim();
    const status = (c.req.query('status') || 'completed').trim();

    const where = [];
    const params = [];
    if (status !== 'all') {
      if (status === 'completed') {
        where.push('completedAt IS NOT NULL');
      } else if (status === 'received') {
        where.push('completedAt IS NULL');
      }
    }
    if (dateKey) {
      if (!/^\d{8}$/.test(dateKey)) return c.json({ error: 'Invalid dateKey' }, 400);
      where.push('dateKey = ?');
      params.push(dateKey);
    } else {
      if (from > 0) {
        where.push('createdAt >= ?');
        params.push(from);
      }
      if (to > 0) {
        where.push('createdAt <= ?');
        params.push(to);
      }
    }
    if (q) {
      where.push('(orderNumber LIKE ? OR COALESCE(phoneNumber, "") LIKE ? OR id LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeLimit = Math.trunc(limit);
    const safeOffset = Math.trunc(offset);
    const sql = `
      SELECT
        dateKey,
        COUNT(*) AS orders,
        COALESCE(SUM(total), 0) AS revenue,
        SUM(completedAt IS NOT NULL) AS completed,
        MAX(createdAt) AS lastOrderAt
      FROM orders
      ${whereSql}
      GROUP BY dateKey
      ORDER BY dateKey DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;

    const [rows] = await pool.execute(sql, params);
    const days = (Array.isArray(rows) ? rows : []).map((r) => ({
      dateKey: String(r.dateKey),
      orders: Number(r.orders || 0),
      revenue: Number(r.revenue || 0),
      completed: Number(r.completed || 0),
      lastOrderAt: r.lastOrderAt != null ? Number(r.lastOrderAt) : null,
    }));

    return c.json({ success: true, days, limit, offset, status });
  } catch (e) {
    console.error('Error fetching order history days', e);
    return c.json({ error: 'Failed to fetch order history days' }, 500);
  }
});

// Admin Orders: basic stats for cashier dashboard
app.get('/api/admin/orders/stats', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  try {
    const dateKey = await getCurrentDateKey();

    const [liveRows] = await pool.execute(
      'SELECT COUNT(*) AS count FROM orders WHERE completedAt IS NULL'
    );
    const liveTotal = Number(liveRows?.[0]?.count || 0);

    const [todayRows] = await pool.execute(
      'SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE dateKey = ?',
      [dateKey]
    );
    const todayOrders = Number(todayRows?.[0]?.orders || 0);
    const todayRevenue = Number(todayRows?.[0]?.revenue || 0);

    const [completedTodayRows] = await pool.execute(
      'SELECT COUNT(*) AS completed FROM orders WHERE dateKey = ? AND completedAt IS NOT NULL',
      [dateKey]
    );
    const todayCompleted = Number(completedTodayRows?.[0]?.completed || 0);

    return c.json({
      success: true,
      live: { total: liveTotal },
      today: { dateKey, orders: todayOrders, completed: todayCompleted, revenue: todayRevenue },
    });
  } catch (e) {
    console.error('Error fetching order stats', e);
    return c.json({ error: 'Failed to fetch order stats' }, 500);
  }
});

app.post('/api/admin/orders/complete-all', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;

  const conn = await pool.getConnection();
  let finalizationLockHeld = false;
  try {
    if (!(await acquireNamedLock(conn, ORDER_FINALIZATION_LOCK_NAME, 30))) {
      return c.json({ error: 'Order queue is busy. Please try again.' }, 503);
    }
    finalizationLockHeld = true;

    const cutoffCreatedAt = Date.now();
    const completedAt = Date.now();
    const [updateResult] = await conn.execute(
      'UPDATE orders SET status=?, completedAt=? WHERE completedAt IS NULL AND createdAt <= ?',
      ['completed', completedAt, cutoffCreatedAt]
    );
    const completedCount = Number(updateResult?.affectedRows || 0);

    const [remainingRows] = await conn.execute(
      'SELECT COUNT(*) AS count FROM orders WHERE completedAt IS NULL'
    );
    const remainingLive = Number(remainingRows?.[0]?.count || 0);

    return c.json({
      success: true,
      completedCount,
      remainingLive,
      cutoffCreatedAt,
    });
  } catch (e) {
    console.error('Error completing all live orders', e);
    return c.json({ error: 'Failed to complete live orders' }, 500);
  } finally {
    if (finalizationLockHeld) {
      await releaseNamedLock(conn, ORDER_FINALIZATION_LOCK_NAME);
    }
    conn.release();
  }
});

// Update order status
app.post('/api/admin/orders/:id/status', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const idParam = c.req.param('id');
    const { status } = await c.req.json();
    if (!status) return c.json({ error: 'Status required' }, 400);
    if (status !== 'completed') {
      return c.json({ error: 'Only completed is allowed' }, 400);
    }
    const dbId = idParam.startsWith('order:') ? idParam : `order:${idParam}`;
    await pool.execute('UPDATE orders SET status=?, completedAt=? WHERE id=?', [
      status,
      Date.now(),
      dbId,
    ]);
    return c.json({ success: true });
  } catch (e) {
    console.error('Error updating order status', e);
    return c.json({ error: 'Failed to update order status' }, 500);
  }
});

// Image upload stub
app.post('/api/admin/upload-image', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const body = await c.req.parseBody();
    const raw = body?.file;
    const file = Array.isArray(raw) ? raw[0] : raw;

    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'file is required (multipart/form-data)' }, 400);
    }

    const contentTypeRaw = String(file.type || '').toLowerCase().trim();
    const contentType =
      contentTypeRaw === 'image/jpg' || contentTypeRaw === 'image/pjpeg'
        ? 'image/jpeg'
        : contentTypeRaw;
    const extFromName = path.extname(String(file.name || '')).toLowerCase();
    const typeFromExt = EXT_TO_IMAGE_CONTENT_TYPE[extFromName] || '';
    const effectiveImageType = contentType || typeFromExt;
    const size = Number(file.size || 0);
    if (!effectiveImageType.startsWith('image/')) {
      return c.json({ error: 'Only image uploads are allowed' }, 400);
    }
    if (!UPLOAD_ALLOWED_IMAGE_TYPES.has(effectiveImageType)) {
      return c.json({ error: 'Unsupported image format. Please upload JPG or PNG.' }, 400);
    }
    if (size > MAX_UPLOAD_IMAGE_BYTES) {
      return c.json({ error: 'Image too large (max 1MB)' }, 400);
    }

    const extFromType = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const ext = extFromType[effectiveImageType] || '.bin';
    const safeExt = ext.startsWith('.')
      ? ext.replace(/[^.a-z0-9]/g, '')
      : `.${ext.replace(/[^a-z0-9]/g, '')}`;
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt || '.bin'}`;

    const buf = Buffer.from(await file.arrayBuffer());
    await pool.execute(
      `INSERT INTO uploaded_images
       (filename, contentType, data, byteSize, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [name, effectiveImageType, buf, buf.length, Date.now()]
    );

    try {
      await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
    } catch (error) {
      console.warn('Image persisted to database but local cache write failed', error);
    }

    const origin = getPublicBaseUrl(c);
    return c.json({ success: true, imageUrl: `${origin}/uploads/${name}` });
  } catch (e) {
    console.error('Error uploading image', e);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

// Remove image from an item (and delete local file if applicable)
app.delete('/api/admin/menu/item/:id/image', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
    const id = c.req.param('id');
    const [rows] = await pool.execute('SELECT imageUrl FROM items WHERE id = ? LIMIT 1', [id]);
    const imageUrl = rows && rows[0] ? String(rows[0].imageUrl || '') : '';
    await pool.execute('UPDATE items SET imageUrl = NULL WHERE id = ?', [id]);
    await deleteUploadedImage(imageUrl);
    return c.json({ success: true });
  } catch (e) {
    console.error('Error removing item image', e);
    return c.json({ error: 'Failed to remove image' }, 500);
  }
});

app.get('*', async (c) => {
  const requestPath = c.req.path || '/';
  if (requestPath.startsWith('/api/') || requestPath.startsWith('/uploads/')) {
    return c.notFound();
  }

  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const served = await serveBuiltFile(c, relativePath, true);
  if (served) return served;
  return c.notFound();
});

const PORT = Number(process.env.PORT || 4000);
const HOST = (process.env.HOST || '0.0.0.0').trim();

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
const stopTelegramAgent = startTelegramAgent();

const shutdown = (signal, exitCode = 0, error) => {
  console.log(`${signal} received, shutting down...`);
  if (error) {
    console.error(error);
  }
  let exited = false;

  const finish = async () => {
    if (exited) return;
    exited = true;
    stopTelegramAgent();
    try {
      await pool.end();
    } catch (e) {
      console.error('Error closing DB pool', e);
    }
    process.exit(exitCode);
  };

  if (server?.close) {
    server.close(() => {
      void finish();
    });
  } else {
    void finish();
  }

  setTimeout(() => process.exit(exitCode || 1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => shutdown('unhandledRejection', 1, reason));
process.on('uncaughtException', (error) => shutdown('uncaughtException', 1, error));
