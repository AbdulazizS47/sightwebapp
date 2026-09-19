// Run only against an isolated database on local MySQL:
// SIGHT_TEST_MYSQL=1 npx vitest run src/server/order-deletion.mysql.test.js
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteOrderAndRestore } from './order-deletion.js';

const suite = process.env.SIGHT_TEST_MYSQL === '1' ? describe : describe.skip;
suite('order deletion against isolated local MySQL', () => {
  let db;
  let admin;
  const database = `sight_delete_test_${randomUUID().replaceAll('-', '')}`;
  const id = 'order:20260919-005';
  beforeAll(async () => {
    const host = process.env.MYSQL_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Tests require local MySQL');
    const config = { host, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' };
    admin = await mysql.createConnection(config);
    await admin.query(`CREATE DATABASE \`${database}\``);
    db = mysql.createPool({ ...config, database, connectionLimit: 5 });
    for (const sql of [
      'CREATE TABLE users (id VARCHAR(64) PRIMARY KEY)',
      'CREATE TABLE loyalty_accounts (userId VARCHAR(64) PRIMARY KEY, points INT NOT NULL, enabled INT DEFAULT 1)',
      'CREATE TABLE orders (id VARCHAR(64) PRIMARY KEY, userId VARCHAR(64), orderNumber VARCHAR(64), items JSON, total DECIMAL(10,2), discountCode VARCHAR(64), createdAt BIGINT, loyaltyPointsEarned TINYINT NULL, loyaltyPointsEstimated TINYINT DEFAULT 0)',
      'CREATE TABLE inventory_items (id VARCHAR(64) PRIMARY KEY, stockQty DECIMAL(12,2), lowStockThreshold DECIMAL(12,2), lowStockAlertSentAt BIGINT, updatedAt BIGINT)',
      `CREATE TABLE inventory_movements (id INT PRIMARY KEY AUTO_INCREMENT, inventoryItemId VARCHAR(64), direction VARCHAR(8), qty DECIMAL(12,2), reason VARCHAR(32), orderId VARCHAR(64), note TEXT, createdByUserId VARCHAR(64), createdAt BIGINT, FOREIGN KEY (inventoryItemId) REFERENCES inventory_items(id), FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE SET NULL, FOREIGN KEY (createdByUserId) REFERENCES users(id))`,
      'CREATE TABLE print_jobs (id INT PRIMARY KEY AUTO_INCREMENT, orderId VARCHAR(64), FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE)',
      'CREATE TABLE order_counters (dateKey VARCHAR(16) PRIMARY KEY, currentNumber INT)',
    ]) await db.query(sql);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
  });
  beforeEach(async () => {
    for (const table of ['print_jobs', 'inventory_movements', 'orders', 'loyalty_accounts', 'inventory_items', 'users', 'order_counters']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO users VALUES ('customer'), ('admin')");
    await db.query("INSERT INTO loyalty_accounts VALUES ('customer', 3, 0)");
    await db.query("INSERT INTO orders VALUES (?, 'customer', '20260919-005', '[]', 14, 'SAVE', 100, 1, 0)", [id]);
    await db.query("INSERT INTO inventory_items VALUES ('beans', 40, 50, 99, 100), ('cups', 9, 2, NULL, 100)");
    await db.query("INSERT INTO inventory_movements (inventoryItemId,direction,qty,reason,orderId,createdAt) VALUES ('beans','out',40,'sale',?,100),('cups','out',2,'sale',?,100)", [id, id]);
    await db.query('INSERT INTO print_jobs (orderId) VALUES (?)', [id]);
    await db.query("INSERT INTO order_counters VALUES ('20260919', 5)");
  });
  const rows = async (sql, params = []) => (await db.query(sql, params))[0];

  it('restores recorded quantities, reverses loyalty, removes sales/discount/printing and preserves the audit', async () => {
    const result = await deleteOrderAndRestore(db, id, 'admin');
    expect(result.deleted).toBe(true);
    expect(result.restoredInventory).toEqual([{ inventoryItemId: 'beans', qty: 40, stockQty: 80 }, { inventoryItemId: 'cups', qty: 2, stockQty: 11 }]);
    expect(await rows('SELECT * FROM orders')).toHaveLength(0);
    expect(await rows('SELECT * FROM print_jobs')).toHaveLength(0);
    expect((await rows('SELECT * FROM loyalty_accounts'))[0]).toMatchObject({ points: 2, enabled: 0 });
    expect((await rows("SELECT * FROM inventory_items WHERE id='beans'"))[0].lowStockAlertSentAt).toBeNull();
    expect(await rows("SELECT * FROM inventory_movements WHERE reason='sale'")).toHaveLength(0);
    expect(await rows("SELECT * FROM inventory_movements WHERE reason='order_deletion'")).toHaveLength(2);
    expect((await rows('SELECT currentNumber FROM order_counters'))[0].currentNumber).toBe(5);
  });
  it('makes concurrent duplicate deletion idempotent', async () => {
    const results = await Promise.all([deleteOrderAndRestore(db, id), deleteOrderAndRestore(db, id)]);
    expect(results.filter((r) => r.deleted)).toHaveLength(1);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans'"))[0].stockQty)).toBe(80);
    expect((await rows('SELECT points FROM loyalty_accounts'))[0].points).toBe(2);
  });
  it('rolls all changes back if recording the restoration fails', async () => {
    await expect(deleteOrderAndRestore(db, id, 'missing-actor')).rejects.toThrow();
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans'"))[0].stockQty)).toBe(40);
    expect(await rows('SELECT * FROM orders')).toHaveLength(1);
    expect(await rows('SELECT * FROM print_jobs')).toHaveLength(1);
    expect(await rows("SELECT * FROM inventory_movements WHERE reason='sale'")).toHaveLength(2);
    expect((await rows('SELECT points FROM loyalty_accounts'))[0].points).toBe(3);
  });
  it('restores the previous loyalty cycle when its reward order is deleted', async () => {
    await db.query('UPDATE orders SET items = ? WHERE id = ?', [JSON.stringify([{id: 'reward-discount', price: -9}]), id]);
    await db.query('UPDATE loyalty_accounts SET points = 5');
    expect((await deleteOrderAndRestore(db, id)).loyaltyPointsChange).toBe(-1);
    expect((await rows('SELECT points FROM loyalty_accounts'))[0].points % 5).toBe(4);
  });
  it('does not remove a stamp when the order skipped an available reward', async () => {
    await db.query('UPDATE orders SET loyaltyPointsEarned = 0');
    expect((await deleteOrderAndRestore(db, id)).loyaltyPointsChange).toBe(0);
  });
  it('never fabricates stock for orders placed before inventory was linked', async () => {
    await db.query('DELETE FROM inventory_movements');
    expect((await deleteOrderAndRestore(db, id)).restoredInventory).toEqual([]);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans'"))[0].stockQty)).toBe(40);
  });
  it('handles guest orders without a loyalty account', async () => {
    await db.query('UPDATE orders SET userId = NULL');
    expect((await deleteOrderAndRestore(db, id)).loyaltyPointsChange).toBe(0);
  });
  it('persists legacy estimates before deleting so later deletions do not reclassify skipped orders', async () => {
    await db.query('UPDATE orders SET loyaltyPointsEarned = NULL, createdAt = 5');
    for (let n = 1; n <= 4; n++) await db.query('INSERT INTO orders (id,userId,items,createdAt) VALUES (?, ?, ?, ?)', [`older-${n}`, 'customer', '[]', n]);
    await db.query('UPDATE loyalty_accounts SET points = 4');
    const result = await deleteOrderAndRestore(db, id);
    expect(result.loyaltyReconstructed).toBe(true);
    expect(result.loyaltyPointsChange).toBe(0);
    expect(await rows('SELECT * FROM orders WHERE loyaltyPointsEarned IS NULL')).toHaveLength(0);
  });
});
