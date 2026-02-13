import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, initSchema, getTodayNextDisplayNumber, ensureDatabase } from './db.js';
import { sendOtpSms } from './sms.js';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = CORS_ORIGINS;
      if (!allowed.length) return '*';
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
const OTP_DEV_MODE = (process.env.OTP_DEV_MODE || '').trim() === 'true';
const PRINT_DEVICE_KEY = (process.env.PRINT_DEVICE_KEY || '').trim();
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
const PRINT_JOB_STALE_MS = Math.max(
  Number(process.env.PRINT_JOB_STALE_MS || 2 * 60 * 1000) || 2 * 60 * 1000,
  30 * 1000
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
// In-memory cache of sessions (persistent store is MySQL)
const sessions = new Map();

const logStartupWarning = (message) => {
  console.warn(`[startup] ${message}`);
};
if (!PRINT_DEVICE_KEY) {
  logStartupWarning('PRINT_DEVICE_KEY is not set; print bridge will not be able to claim jobs.');
}
if (SMS_PROVIDER === 'console' && !OTP_DEV_MODE) {
  logStartupWarning('SMS_PROVIDER is "console"; OTPs will be logged to stdout.');
}

async function getSessionUser(token) {
  if (!token) return null;
  const cached = sessions.get(token);
  const now = Date.now();
  if (cached) {
    if (cached.expiresAt && cached.expiresAt <= now) {
      sessions.delete(token);
      try {
        await pool.execute('DELETE FROM sessions WHERE token = ?', [token]);
      } catch {}
      return null;
    }
    return cached.user;
  }
  try {
    const [rows] = await pool.execute(
      `
      SELECT u.id, u.phoneNumber, u.name, u.role, s.expiresAt
      FROM sessions s
      JOIN users u ON u.id = s.userId
      WHERE s.token = ?
      LIMIT 1
    `,
      [token]
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return null;
    const expiresAt = row.expiresAt != null ? Number(row.expiresAt) : null;
    if (expiresAt != null && expiresAt <= now) {
      try {
        await pool.execute('DELETE FROM sessions WHERE token = ?', [token]);
      } catch {}
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
    await pool.execute('UPDATE sessions SET lastSeenAt = ?, expiresAt = ? WHERE token = ?', [
      now,
      effectiveExpiresAt,
      token,
    ]);
    return user;
  } catch (e) {
    console.error('Failed to load session from DB', e);
    return null;
  }
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
  if (ADMIN_TOKEN && headerToken === ADMIN_TOKEN) return null;

  return c.json({ error: 'Unauthorized' }, 401);
}

function requirePrintDevice(c) {
  if (!PRINT_DEVICE_KEY) return c.json({ error: 'Print device not configured' }, 503);
  const key = (c.req.header('X-Device-Key') || '').trim();
  if (!key || key !== PRINT_DEVICE_KEY) return c.json({ error: 'Unauthorized' }, 401);
  return null;
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
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'application/octet-stream';

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
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

// Demo Auth Endpoints
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

    const shouldReturn =
      OTP_DEV_MODE || (process.env.OTP_DEBUG_RETURN_CODE || '').trim() === 'true';
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
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(sessionToken, { user, expiresAt });
    await pool.execute(
      'INSERT INTO sessions (token, userId, createdAt, lastSeenAt, expiresAt) VALUES (?, ?, ?, ?, ?)',
      [sessionToken, id, Date.now(), Date.now(), expiresAt]
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
    await pool.execute('UPDATE sessions SET lastSeenAt = ? WHERE token = ?', [Date.now(), token]);
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
    await pool.execute('UPDATE sessions SET lastSeenAt = ? WHERE token = ?', [Date.now(), token]);
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
app.post('/api/admin/reset-menu', async (c) => {
  const unauthorized = await requireAdmin(c);
  if (unauthorized) return unauthorized;
  try {
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
    const validCategoryIds = categories.map((c) => c.id);
    for (const item of existingItems) {
      if (!validCategoryIds.includes(item.category)) {
        await pool.execute('DELETE FROM items WHERE id = ?', [item.id]);
      }
    }

    // Seed demo items
    const demoItems = [
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

    for (const it of demoItems) {
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
  let { id, nameEn, nameAr, price, category, description, imageUrl, available } = body;
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
    'INSERT INTO items (id, nameEn, nameAr, price, category, description, imageUrl, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, nameEn, nameAr, price, category, description || null, imageUrl || null, available ? 1 : 0]
  );
  return c.json({
    success: true,
    item: {
      id,
      nameEn,
      nameAr,
      price,
      category,
      description: description || null,
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
  const { nameEn, nameAr, price, category, description, imageUrl, available } = body;
  await pool.execute(
    'UPDATE items SET nameEn=?, nameAr=?, price=?, category=?, description=?, imageUrl=?, available=? WHERE id=?',
    [nameEn, nameAr, price, category, description || null, imageUrl || null, available ? 1 : 0, id]
  );
  return c.json({
    success: true,
    item: {
      id,
      nameEn,
      nameAr,
      price,
      category,
      description: description || null,
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
        return { id, quantity };
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
      const name = effectiveLanguage === 'ar' ? nameAr || nameEn : nameEn || nameAr;
      return {
        id: it.id,
        name,
        nameEn,
        nameAr,
        price: Number.isFinite(price) ? price : 0,
        quantity: it.quantity,
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

    const now = new Date();
    const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const displayNumber = await getTodayNextDisplayNumber(dateKey);
    const orderNumber = `${dateKey}-${String(displayNumber).padStart(3, '0')}`;
    const orderId = `order:${orderNumber}`;

    const createdAt = Date.now();
    await pool.execute(
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
        paymentMethod || 'cash',
        'received',
        null,
        createdAt,
      ]
    );

    // Enqueue print job (best-effort)
    try {
      await pool.execute(
        'INSERT INTO print_jobs (orderId, status, attempts, createdAt) VALUES (?, ?, ?, ?)',
        [orderId, 'pending', 0, createdAt]
      );
    } catch (e) {
      console.error('Failed to enqueue print job', e);
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
      phoneNumber: effectivePhoneNumber,
      items: effectiveItems,
      total: effectiveTotal,
      subtotalExclVat,
      vatAmount,
      totalWithVat: effectiveTotal,
      paymentMethod: paymentMethod || 'cash',
      status: 'received',
    };

    return c.json({
      success: true,
      orderId,
      orderNumber,
      displayNumber,
      order: orderSummary,
    });
  } catch (e) {
    console.error('Error creating order', e);
    return c.json({ error: 'Failed to create order' }, 500);
  }
});

// Print jobs: claim next pending job (for print bridge)
app.get('/api/print/ping', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  return c.json({ success: true });
});

app.post('/api/print/jobs/claim', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const staleBefore = Date.now() - PRINT_JOB_STALE_MS;
    const [rows] = await conn.execute(
      `SELECT * FROM print_jobs
       WHERE status = ?
          OR (status = ? AND claimedAt IS NOT NULL AND claimedAt < ?)
       ORDER BY createdAt ASC
       LIMIT 1
       FOR UPDATE`,
      ['pending', 'printing', staleBefore]
    );
    const job = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!job) {
      await conn.commit();
      return c.json({ success: true, job: null });
    }

    const now = Date.now();
    await conn.execute(
      'UPDATE print_jobs SET status = ?, claimedAt = ?, attempts = attempts + 1 WHERE id = ?',
      ['printing', now, job.id]
    );
    await conn.commit();

    const [orderRows] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [
      job.orderId,
    ]);
    const orderRow = Array.isArray(orderRows) && orderRows[0] ? orderRows[0] : null;
    if (!orderRow) {
      await pool.execute(
        'UPDATE print_jobs SET status = ?, lastError = ?, printedAt = NULL WHERE id = ?',
        ['failed', 'Order not found', job.id]
      );
      return c.json({ success: false, error: 'Order not found' }, 404);
    }

    return c.json({
      success: true,
      job: {
        id: Number(job.id),
        orderId: String(job.orderId),
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
app.post('/api/print/jobs/:id/ack', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  const id = Number(c.req.param('id')) || 0;
  if (!id) return c.json({ error: 'Invalid job id' }, 400);

  try {
    await pool.execute(
      'UPDATE print_jobs SET status = ?, printedAt = ?, lastError = NULL WHERE id = ?',
      ['printed', Date.now(), id]
    );
    return c.json({ success: true });
  } catch (e) {
    console.error('Failed to ack print job', e);
    return c.json({ error: 'Failed to update print job' }, 500);
  }
});

// Print jobs: mark failure
app.post('/api/print/jobs/:id/fail', async (c) => {
  const unauthorized = requirePrintDevice(c);
  if (unauthorized) return unauthorized;
  const id = Number(c.req.param('id')) || 0;
  if (!id) return c.json({ error: 'Invalid job id' }, 400);

  try {
    const body = await c.req.json().catch(() => ({}));
    const message = typeof body?.error === 'string' ? body.error : 'Print failed';
    await pool.execute(
      'UPDATE print_jobs SET status = ?, lastError = ?, printedAt = NULL WHERE id = ?',
      ['failed', message, id]
    );
    return c.json({ success: true });
  } catch (e) {
    console.error('Failed to mark print job failed', e);
    return c.json({ error: 'Failed to update print job' }, 500);
  }
});

// Customer Orders: fetch a single order for tracking
app.get('/api/orders/:id', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const sessionUser = await getSessionUser(token);
    if (!sessionUser) return c.json({ error: 'Unauthorized' }, 401);

    const raw = decodeURIComponent(String(c.req.param('id') || '')).trim();
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
    const [rows] = await pool.execute(
      'SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
      [sessionUser.id, limit]
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

    if (from > 0) {
      where.push('createdAt >= ?');
      params.push(from);
    }
    if (to > 0) {
      where.push('createdAt <= ?');
      params.push(to);
    }
    if (q) {
      where.push('(orderNumber LIKE ? OR COALESCE(phoneNumber, "") LIKE ? OR id LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM orders ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

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
    if (from > 0) {
      where.push('createdAt >= ?');
      params.push(from);
    }
    if (to > 0) {
      where.push('createdAt <= ?');
      params.push(to);
    }
    if (q) {
      where.push('(orderNumber LIKE ? OR COALESCE(phoneNumber, "") LIKE ? OR id LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
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
      LIMIT ? OFFSET ?
    `;

    const finalParams = [...params, limit, offset];
    const [rows] = await pool.execute(sql, finalParams);
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
    const now = new Date();
    const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

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

    const contentType = String(file.type || '').toLowerCase();
    const size = Number(file.size || 0);
    if (!contentType.startsWith('image/')) {
      return c.json({ error: 'Only image uploads are allowed' }, 400);
    }
    if (size > 5 * 1024 * 1024) {
      return c.json({ error: 'Image too large (max 5MB)' }, 400);
    }

    const extFromType = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    const ext =
      extFromType[contentType] || path.extname(String(file.name || '')).slice(0, 10) || '.bin';
    const safeExt = ext.startsWith('.')
      ? ext.replace(/[^.a-z0-9]/g, '')
      : `.${ext.replace(/[^a-z0-9]/g, '')}`;
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt || '.bin'}`;

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(UPLOADS_DIR, name), buf);

    const origin = new URL(c.req.url).origin;
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
