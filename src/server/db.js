import 'dotenv/config';
import mysql from 'mysql2/promise';

const parseMysqlUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!url.hostname) return null;
    return {
      host: url.hostname,
      port: url.port || '3306',
      user: decodeURIComponent(url.username || 'root'),
      password: decodeURIComponent(url.password || ''),
      database: url.pathname ? url.pathname.replace(/^\//, '') : '',
    };
  } catch {
    return null;
  }
};

const env = process.env;
const urlConfig =
  parseMysqlUrl(env.MYSQL_URL) ||
  parseMysqlUrl(env.MYSQL_URI) ||
  parseMysqlUrl(env.DATABASE_URL);

const MYSQL_HOST =
  env.MYSQL_HOST || env.MYSQLHOST || (urlConfig ? urlConfig.host : 'localhost');
const MYSQL_PORT =
  env.MYSQL_PORT || env.MYSQLPORT || (urlConfig ? urlConfig.port : '3306');
const MYSQL_USER =
  env.MYSQL_USER || env.MYSQLUSER || (urlConfig ? urlConfig.user : 'root');
const MYSQL_PASSWORD =
  env.MYSQL_PASSWORD ||
  env.MYSQLPASSWORD ||
  (urlConfig ? urlConfig.password : '');
const MYSQL_DATABASE =
  env.MYSQL_DATABASE ||
  env.MYSQLDATABASE ||
  (urlConfig ? urlConfig.database : 'sight_app');
const MYSQL_SSL =
  (env.MYSQL_SSL || '').trim().toLowerCase() === 'true' ||
  (env.MYSQL_SSL || '').trim() === '1';
const MYSQL_SSL_REJECT_UNAUTHORIZED =
  (env.MYSQL_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() === 'true';
const MYSQL_CONNECT_TIMEOUT = Math.max(Number(env.MYSQL_CONNECT_TIMEOUT || 10000) || 10000, 1000);
const MYSQL_SKIP_CREATE_DB =
  (env.MYSQL_SKIP_CREATE_DB || '').trim().toLowerCase() === 'true';

const sslConfig = MYSQL_SSL ? { rejectUnauthorized: MYSQL_SSL_REJECT_UNAUTHORIZED } : undefined;

export const pool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(MYSQL_PORT),
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  connectTimeout: MYSQL_CONNECT_TIMEOUT,
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function ensureDatabase() {
  if (MYSQL_SKIP_CREATE_DB) return;
  // Use a connection without selecting a database to ensure it exists
  let conn;
  try {
    conn = await mysql.createConnection({
      host: MYSQL_HOST,
      port: Number(MYSQL_PORT),
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      multipleStatements: true,
      connectTimeout: MYSQL_CONNECT_TIMEOUT,
      ssl: sslConfig,
    });
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } catch (e) {
    console.error('Failed to ensure database exists', e);
  } finally {
    try {
      if (conn) await conn.end();
    } catch {
      // ignore
    }
  }
}

export async function initSchema() {
  // Create tables if they don't exist
  await pool.execute(
    `
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR(64) PRIMARY KEY,
      nameEn VARCHAR(255) NOT NULL,
      nameAr VARCHAR(255) NOT NULL,
      ` +
      '`order`' +
      ` INT NOT NULL,
      iconUrl VARCHAR(1024) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `
  );

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(64) PRIMARY KEY,
      nameEn VARCHAR(255) NOT NULL,
      nameAr VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      category VARCHAR(64) NOT NULL,
      description TEXT NULL,
      imageUrl VARCHAR(1024) NULL,
      available TINYINT(1) NOT NULL DEFAULT 1,
      FOREIGN KEY (category) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(64) PRIMARY KEY,
      orderNumber VARCHAR(32) NOT NULL,
      displayNumber INT NOT NULL,
      dateKey VARCHAR(16) NOT NULL,
      userId VARCHAR(64) NULL,
      phoneNumber VARCHAR(32) NULL,
      items JSON NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      paymentMethod VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      completedAt BIGINT NULL,
      createdAt BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS order_counters (
      dateKey VARCHAR(16) PRIMARY KEY,
      currentNumber INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // New tables for user profiles and loyalty
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      phoneNumber VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NULL,
      language VARCHAR(16) NULL,
      role VARCHAR(32) NOT NULL,
      createdAt BIGINT NOT NULL,
      updatedAt BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      userId VARCHAR(64) PRIMARY KEY,
      points INT NOT NULL DEFAULT 0,
      tier VARCHAR(32) NOT NULL DEFAULT 'basic',
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      enrollmentDate BIGINT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) PRIMARY KEY,
      userId VARCHAR(64) NOT NULL,
      createdAt BIGINT NOT NULL,
      lastSeenAt BIGINT NOT NULL,
      expiresAt BIGINT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      orderId VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      lastError TEXT NULL,
      claimedAt BIGINT NULL,
      printedAt BIGINT NULL,
      createdAt BIGINT NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      phoneNumber VARCHAR(32) NOT NULL,
      codeHash CHAR(64) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      createdAt BIGINT NOT NULL,
      expiresAt BIGINT NOT NULL,
      consumedAt BIGINT NULL,
      INDEX idx_otp_phone_created (phoneNumber, createdAt),
      INDEX idx_otp_expires (expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Best-effort indexes (ignore if already present)
  const ensureIndex = async (sql) => {
    try {
      await pool.execute(sql);
    } catch {
      // ignore duplicate index / older mysql quirks
    }
  };
  const ensureColumn = async (sql) => {
    try {
      await pool.execute(sql);
    } catch {
      // ignore if column already exists
    }
  };

  await ensureColumn('ALTER TABLE sessions ADD COLUMN expiresAt BIGINT NULL');
  await ensureIndex('CREATE UNIQUE INDEX idx_orders_orderNumber ON orders(orderNumber)');
  await ensureIndex('CREATE INDEX idx_orders_date_display ON orders(dateKey, displayNumber)');
  await ensureIndex('CREATE INDEX idx_orders_createdAt ON orders(createdAt)');
  await ensureIndex('CREATE INDEX idx_orders_status ON orders(status)');
  await ensureColumn('ALTER TABLE orders ADD COLUMN completedAt BIGINT NULL');
  await ensureIndex('CREATE INDEX idx_orders_completedAt ON orders(completedAt)');
  await ensureIndex('CREATE INDEX idx_orders_userId ON orders(userId)');
  await ensureIndex('CREATE INDEX idx_orders_phoneNumber ON orders(phoneNumber)');
  await ensureIndex('CREATE INDEX idx_print_jobs_status_created ON print_jobs(status, createdAt)');
  await ensureIndex('CREATE INDEX idx_print_jobs_orderId ON print_jobs(orderId)');
}

export async function getTodayNextDisplayNumber(dateKey) {
  // Atomic counter per dateKey (safe under concurrency)
  const conn = await pool.getConnection();
  try {
    const [res] = await conn.execute(
      'INSERT INTO order_counters (dateKey, currentNumber) VALUES (?, 1) ON DUPLICATE KEY UPDATE currentNumber = LAST_INSERT_ID(currentNumber + 1)',
      [dateKey]
    );
    // mysql2 returns insertId with LAST_INSERT_ID value
    const next = Number(res.insertId || 1);
    return next;
  } finally {
    conn.release();
  }
}
