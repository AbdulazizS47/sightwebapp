import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, initSchema, ensureDatabase } from './db.js';
import { sendOtpSms } from './sms.js';

const app = new Hono();
const printApi = new Hono();
const NODE_ENV = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

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
const UPLOAD_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_UPLOAD_IMAGE_BYTES = 1024 * 1024;
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
      SELECT u.id, u.phoneNumber, u.name, u.role, s.expiresAt
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

function isOpenForSchedule(now, start, end, timeZone) {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  const nowMin = getMinutesInTimeZone(now, timeZone);
  if (startMin == null || endMin == null || nowMin == null) return null;
  if (startMin === endMin) return true;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

async function ensureUploadsDir() {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create uploads dir', e);
  }
}

// Helpers
async function requireAdmin(c) {
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const sessionUser = await getSessionUser(bearer);
  if (sessionUser?.role === 'admin') return null;

  // Optional fallback for scripted/admin tooling (avoid shipping any admin secret to the browser)
  const headerToken = (c.req.header('x-admin-token') || '').trim();
  if (ADMIN_TOKEN_ENABLED && headerToken === ADMIN_TOKEN) return null;

  return c.json({ error: 'Unauthorized' }, 401);
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
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  return new URL(c.req.url).origin;
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

const INVENTORY_TYPES = new Set(['bean', 'sweet']);
const INVENTORY_UNITS = new Set(['g', 'pcs']);
const BEAN_RESTOCK_OPTIONS_G = [500, 1000];

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
    active: Boolean(Number(row.active)),
    notes: row.notes != null ? String(row.notes) : null,
    isLowStock: stockQty <= lowStockThreshold,
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

// Serve uploaded images
app.get('/uploads/:filename', async (c) => {
  try {
    const filename = c.req.param('filename');
    if (!filename) return c.text('Not found', 404);

    const safeName = path.basename(filename);
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
    return c.text('Not found', 404);
  }
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
    ...(dbLatencyMs != null ? { dbLatencyMs } : {}),
  };

  if (dbStatus === 'error' && HEALTHCHECK_STRICT) {
    return c.json(payload, 503);
  }
  return c.json(payload);
});
app.get('/', (c) => c.text('OK'));

// Public settings (open status + hours)
app.get('/api/settings/public', async (c) => {
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
  return c.json({
    success: true,
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
  });
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
    const user = { id, phoneNumber: normalizedPhone, name: effectiveName, role };
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

    // Ensure loyalty reflects reality (orders drive points; loyalty auto-enables after first order)
    const [rows] = await pool.execute('SELECT * FROM loyalty_accounts WHERE userId = ? LIMIT 1', [
      userId,
    ]);
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const existingPoints = existing ? Number(existing.points || 0) : 0;
    const existingEnabled = existing ? Number(existing.enabled || 0) : 0;
    const existingEnrollment =
      existing && existing.enrollmentDate != null ? Number(existing.enrollmentDate) : null;

    const [orderRows] = await pool.execute('SELECT COUNT(*) AS cnt FROM orders WHERE userId = ?', [
      userId,
    ]);
    const orderCount = Number(orderRows?.[0]?.cnt || 0);

    const points = Math.max(existingPoints, orderCount);
    const shouldEnable = orderCount > 0;

    if (!existing || existingEnabled === 0 || existingPoints !== points) {
      const nowTs = Date.now();
      await pool.execute(
        'INSERT INTO loyalty_accounts (userId, points, tier, enabled, enrollmentDate) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE points=VALUES(points), enabled=VALUES(enabled), enrollmentDate=IFNULL(enrollmentDate, VALUES(enrollmentDate))',
        [
          userId,
          points,
          'basic',
          shouldEnable ? 1 : 0,
          existingEnrollment ?? (shouldEnable ? nowTs : null),
        ]
      );
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
    return c.json({ success: true, items, categories });
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
    return c.json({ success: true, items, categories });
  } catch (e) {
    console.error('Error fetching admin menu', e);
    return c.json({ error: 'Failed to fetch admin menu' }, 500);
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
       (id, nameEn, nameAr, type, unit, stockQty, lowStockThreshold, active, notes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, nameEn, nameAr, type, unit, 0, lowStockThresholdNum, active ? 1 : 0, notes, now, now]
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

    await pool.execute(
      `UPDATE inventory_items
       SET nameEn = ?, nameAr = ?, type = ?, unit = ?, lowStockThreshold = ?, active = ?, notes = ?, updatedAt = ?
       WHERE id = ?`,
      [
        nextNameEn,
        nextNameAr,
        nextType,
        nextUnit,
        nextLowStockThreshold,
        nextActive ? 1 : 0,
        nextNotes,
        now,
        id,
      ]
    );

    return c.json({
      success: true,
      item: mapInventoryItemRow({
        ...existing,
        id,
        nameEn: nextNameEn,
        nameAr: nextNameAr,
        type: nextType,
        unit: nextUnit,
        lowStockThreshold: nextLowStockThreshold,
        active: nextActive ? 1 : 0,
        notes: nextNotes,
        updatedAt: now,
      }),
    });
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
    const nextStockQty = Number(item.stockQty || 0) + Number(qty);

    await conn.execute(
      'UPDATE inventory_items SET stockQty = ?, updatedAt = ? WHERE id = ?',
      [nextStockQty, now, id]
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
  await pool.execute(
    'UPDATE items SET nameEn=?, nameAr=?, price=?, category=?, description=?, descriptionEn=?, descriptionAr=?, imageUrl=?, available=? WHERE id=?',
    [nameEn, nameAr, price, category, description, descriptionEn, descriptionAr, imageUrl || null, available ? 1 : 0, id]
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

app.delete('/api/admin/menu/item/:id', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  const id = c.req.param('id');
  await pool.execute('DELETE FROM items WHERE id=?', [id]);
  return c.json({ success: true });
});

// Orders
app.post('/api/orders/create', async (c) => {
  try {
    const body = await c.req.json();
    const { items, paymentMethod, userId, phoneNumber, redeemReward, language } = body;
    if (!items || items.length === 0) {
      return c.json({ error: 'Order must contain at least one item' }, 400);
    }

    // Link order to session user if available
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    const effectiveUserId = sessionUser?.id || userId || null;
    const effectivePhoneNumber = sessionUser?.phoneNumber || phoneNumber || null;
    const effectiveLanguage = language === 'ar' ? 'ar' : 'en';

    // Normalize items (avoid NaN / invalid data)
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
      return c.json({ error: 'Invalid items payload' }, 400);
    }

    const ids = Array.from(new Set(normalizedItems.map((it) => it.id)));
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT id, nameEn, nameAr, price, available FROM items WHERE id IN (${placeholders})`,
      ids
    );
    const byId = new Map((Array.isArray(rows) ? rows : []).map((r) => [String(r.id), r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return c.json({ error: 'Some items were not found', missing }, 400);
    }
    const unavailable = ids.filter((id) => {
      const row = byId.get(id);
      return row && Number(row.available) === 0;
    });
    if (unavailable.length > 0) {
      return c.json({ error: 'Some items are unavailable', unavailable }, 400);
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
      const name = effectiveLanguage === 'ar' ? displayNameAr || displayNameEn : displayNameEn || displayNameAr;
      return {
        id: it.id,
        name,
        nameEn: displayNameEn,
        nameAr: displayNameAr,
        price: Number.isFinite(price) ? price : 0,
        quantity: it.quantity,
        ...(it.options ? { options: it.options } : {}),
      };
    });

    const computeTotal = (arr) =>
      arr.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

    let effectiveItems = canonicalItems;
    let effectiveTotal = computeTotal(effectiveItems);

    // Fetch loyalty to apply rewards
    if (effectiveUserId && redeemReward) {
      const [rows] = await pool.execute(
        'SELECT points FROM loyalty_accounts WHERE userId = ? AND enabled = 1',
        [effectiveUserId]
      );
      const p = Number(rows?.[0]?.points || 0);
      const stamps = p > 0 ? ((p - 1) % 6) + 1 : 0;
      if (stamps === 3) {
        // Free cup: discount the highest unit price
        const maxUnitPrice = effectiveItems.reduce(
          (max, it) => Math.max(max, Number(it.price) || 0),
          0
        );
        const discount = Math.min(maxUnitPrice, effectiveTotal);
        if (discount > 0) {
          effectiveItems = [
            ...effectiveItems,
            {
              id: 'reward-discount',
              name: effectiveLanguage === 'ar' ? 'خصم المكافأة' : 'Reward discount',
              price: -discount,
              quantity: 1,
            },
          ];
          effectiveTotal = Math.max(0, effectiveTotal - discount);
        }
      } else if (stamps === 6) {
        // 50% off, capped at 20 SAR (represent as a discount line item)
        const baseTotal = effectiveTotal;
        const discount = Math.min(baseTotal * 0.5, 20);
        if (discount > 0) {
          effectiveItems = [
            ...effectiveItems,
            {
              id: 'reward-discount',
              name: effectiveLanguage === 'ar' ? 'خصم المكافأة' : 'Reward discount',
              price: -discount,
              quantity: 1,
            },
          ];
        }
        effectiveTotal = Math.max(0, baseTotal - discount);
      }
    }

    const dateKey = await getCurrentDateKey();
    const paymentMethodValue = paymentMethod || 'cash';
    const roundInventoryQty = (value) => Math.round(Number(value || 0) * 100) / 100;

    let displayNumber = null;
    let orderNumber = null;
    let orderId = null;
    let createdAt = null;
    let inventoryWarnings = null;

    const conn = await pool.getConnection();
    let txOpen = false;
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
          `SELECT id, nameEn, nameAr, unit, stockQty, active
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
          return c.json(
            {
              error: 'Inventory configuration is invalid',
              missingInventoryIds,
              ...(inventoryWarnings ? { inventoryWarnings } : {}),
            },
            500
          );
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
          return c.json(
            {
              error: 'Insufficient inventory',
              insufficient,
              ...(inventoryWarnings ? { inventoryWarnings } : {}),
            },
            409
          );
        }
      }

      const [counterRes] = await conn.execute(
        'INSERT INTO order_counters (dateKey, currentNumber) VALUES (?, 1) ON DUPLICATE KEY UPDATE currentNumber = LAST_INSERT_ID(currentNumber + 1)',
        [dateKey]
      );
      displayNumber = Number(counterRes.insertId || 1);
      orderNumber = `${dateKey}-${String(displayNumber).padStart(3, '0')}`;
      orderId = `order:${orderNumber}`;
      createdAt = Date.now();

      await conn.execute(
        'INSERT INTO orders (id, orderNumber, displayNumber, dateKey, userId, phoneNumber, items, total, paymentMethod, status, completedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        ]
      );

      if (inventoryRequirements.size > 0) {
        for (const requirement of inventoryRequirements.values()) {
          const inventoryRow = lockedInventoryById.get(requirement.inventoryItemId);
          if (!inventoryRow) continue;
          const nextStockQty = roundInventoryQty(
            Number(inventoryRow.stockQty || 0) - Number(requirement.requiredQty || 0)
          );

          await conn.execute(
            'UPDATE inventory_items SET stockQty = ?, updatedAt = ? WHERE id = ?',
            [nextStockQty, createdAt, requirement.inventoryItemId]
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
              null,
              createdAt,
            ]
          );

          inventoryRow.stockQty = nextStockQty;
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
      // Accrue loyalty points (1 per order). UI derives the 6-stamp cycle from this value.
      await pool.execute(
        'UPDATE loyalty_accounts SET enabled=1, points = points + 1 WHERE userId = ?',
        [effectiveUserId]
      );
    }

    const VAT_RATE = 0.15;
    const vatAmount = effectiveTotal * (VAT_RATE / (1 + VAT_RATE));
    const subtotalExclVat = effectiveTotal - vatAmount;
    const orderSummary = {
      id: orderId,
      orderNumber,
      displayNumber,
      createdAt,
      userId: effectiveUserId,
      userName: sessionUser?.name || null,
      phoneNumber: effectivePhoneNumber,
      items: effectiveItems,
      total: effectiveTotal,
      subtotalExclVat,
      vatAmount,
      totalWithVat: effectiveTotal,
      paymentMethod: paymentMethod || 'cash',
      status: 'received',
    };

    const responsePayload = {
      success: true,
      orderId,
      orderNumber,
      displayNumber,
      order: orderSummary,
    };
    if (inventoryWarnings) {
      responsePayload.inventoryWarnings = inventoryWarnings;
    }

    return c.json(responsePayload);
  } catch (e) {
    console.error('Error creating order', e);
    return c.json({ error: 'Failed to create order' }, 500);
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
// Admin Orders: active list
function mapOrderRow(row) {
  const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
  const total = Number(row.total);
  // Prices are VAT-inclusive; compute VAT portion without adding on top
  const VAT_RATE = 0.15;
  const vatAmount = total * (VAT_RATE / (1 + VAT_RATE));
  const subtotalExclVat = total - vatAmount;
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
      'SELECT COUNT(*) AS count FROM orders WHERE status != ?',
      ['completed']
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
    await fs.writeFile(path.join(UPLOADS_DIR, name), buf);

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

    if (imageUrl) {
      let pathPart = imageUrl;
      try {
        pathPart = new URL(imageUrl).pathname;
      } catch {
        // ignore
      }
      if (pathPart.startsWith('/uploads/')) {
        const fileName = pathPart.slice('/uploads/'.length).replace(/\?.*$/, '');
        const filePath = path.join(UPLOADS_DIR, path.basename(fileName));
        try {
          await fs.unlink(filePath);
        } catch {
          // Ignore if already missing
        }
      }
    }

    await pool.execute('UPDATE items SET imageUrl = NULL WHERE id = ?', [id]);
    return c.json({ success: true });
  } catch (e) {
    console.error('Error removing item image', e);
    return c.json({ error: 'Failed to remove image' }, 500);
  }
});

const PORT = Number(process.env.PORT || 4000);
const HOST = (process.env.HOST || '0.0.0.0').trim();

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

const shutdown = (signal, exitCode = 0, error) => {
  console.log(`${signal} received, shutting down...`);
  if (error) {
    console.error(error);
  }
  let exited = false;

  const finish = async () => {
    if (exited) return;
    exited = true;
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
