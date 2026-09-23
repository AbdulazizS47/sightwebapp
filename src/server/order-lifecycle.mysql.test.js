// Opt-in integration tests: real server and schema, isolated LOCAL database only.
import 'dotenv/config';
import mysql from 'mysql2/promise';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const suite = process.env.SIGHT_TEST_MYSQL === '1' ? describe : describe.skip;
suite('HTTP order lifecycle and schema upgrade', () => {
  const database = `sight_lifecycle_test_${randomUUID().replaceAll('-', '')}`;
  const adminToken = randomBytes(32).toString('hex');
  const sessionToken = randomBytes(32).toString('hex');
  const cashierToken = randomBytes(32).toString('hex');
  let admin;
  let db;
  let child;
  let base;
  let env;
  const rows = async (sql, values = []) => (await db.execute(sql, values))[0];
  async function start() {
    child = spawn(process.execPath, ['src/server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output.slice(-2000)}`)), 15000);
      child.on('error', reject);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output.slice(-2000)}`)); });
      const receive = (chunk) => {
        output += chunk.toString();
        if (output.includes('Server running at')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
    });
  }
  async function stop() {
    if (child && child.exitCode == null && child.signalCode == null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
  async function request(path, { method = 'GET', body, customer = false, cashier = false, anonymous = false } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(anonymous ? {} : customer || cashier ? { Authorization: `Bearer ${cashier ? cashierToken : sessionToken}` } : { 'x-admin-token': adminToken }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  const create = (quantity = 1, redeemReward = false) => request('/orders/create', {
    method: 'POST', customer: true,
    body: { items: [{id: 'qamar-test', quantity}], paymentMethod: 'cash', redeemReward, language: 'en' },
  });
  const remove = (id, options = {}) => request(`/admin/orders/${encodeURIComponent(id)}`, {method:'DELETE', ...options});
  beforeAll(async () => {
    const host = process.env.MYSQL_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Local MySQL required');
    const config = {host, port:Number(process.env.MYSQL_PORT || 3306), user:process.env.MYSQL_USER || 'root', password:process.env.MYSQL_PASSWORD || ''};
    admin = await mysql.createConnection(config);
    await admin.query(`CREATE DATABASE \`${database}\``);
    db = await mysql.createConnection({...config, database});
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    base = `http://127.0.0.1:${port}/api`;
    env = {...process.env, MYSQL_DATABASE:database, MYSQL_HOST:host, MYSQL_PORT:String(config.port), MYSQL_USER:config.user, MYSQL_PASSWORD:config.password,
      MYSQL_SKIP_CREATE_DB:'true', DEV_SEED_DISCOUNT_CODES:'false', HOST:'127.0.0.1', PORT:String(port), NODE_ENV:'test',
      ADMIN_TOKEN:adminToken, ORDER_NOTIFY_PROVIDER:'disabled', TELEGRAM_AGENT_ENABLED:'false', SMS_PROVIDER:'console',
      TELEGRAM_BOT_TOKEN:'', TELEGRAM_CHAT_ID:'', WHATSAPP_CLOUD_API_TOKEN:'', OPENAI_OPERATIONAL_AGENT_ENABLED:'false'};
    await start();
    const now = Date.now();
    await rows("INSERT INTO categories (id,nameEn,nameAr,`order`) VALUES ('v60','V60','V60',1)");
    await rows("INSERT INTO items (id,nameEn,nameAr,price,category) VALUES ('qamar-test','Qamar test','اختبار',14,'v60')");
    await rows("INSERT INTO inventory_items (id,nameEn,nameAr,type,unit,stockQty,lowStockThreshold,createdAt,updatedAt) VALUES ('beans-test','Test beans','اختبار','bean','g',500,50,?,?)", [now,now]);
    await rows("INSERT INTO inventory_usage_rules (menuItemId,inventoryItemId,consumeQty,createdAt,updatedAt) VALUES ('qamar-test','beans-test',20,?,?)", [now,now]);
    for (const [id,phone,role,token] of [['customer-test','+966500000001','user',sessionToken],['cashier-test','+966500000002','cashier',cashierToken]]) {
      await rows('INSERT INTO users (id,phoneNumber,name,role,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', [id,phone,'Test user',role,now,now]);
      await rows('INSERT INTO sessions (token,userId,createdAt,lastSeenAt,expiresAt) VALUES (?,?,?,?,?)', [token,id,now,now,now+3600000]);
    }
    await rows("INSERT INTO loyalty_accounts (userId,points,tier,enabled) VALUES ('customer-test',4,'basic',1)");
    await rows("INSERT INTO app_settings (`key`,`value`,updatedAt) VALUES ('scheduleEnabled','false',?),('openStatus','true',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)", [now,now]);
    // Model an existing installation without the new columns, then restart twice.
    await stop();
    await rows('ALTER TABLE orders DROP COLUMN loyaltyPointsEarned, DROP COLUMN loyaltyPointsEstimated');
    await start();
    await stop();
    await start();
  }, 45000);
  afterAll(async () => {
    await stop();
    if (db) await db.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
  }, 15000);

  it('upgrades and restarts without changing existing stock or loyalty balances', async () => {
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(4);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(500);
    const columns = await rows('SHOW COLUMNS FROM orders');
    expect(columns.map((c) => c.Field)).toEqual(expect.arrayContaining(['loyaltyPointsEarned','loyaltyPointsEstimated']));
  });
  it('creates, protects and deletes a real order using the historical recipe, with no lost skipped reward', async () => {
    const result = await create(2);
    expect(result.status).toBe(200);
    const orderId = result.body.orderId;
    expect(orderId).toBeTruthy();
    expect((await rows('SELECT loyaltyPointsEarned FROM orders WHERE id=?',[orderId]))[0].loyaltyPointsEarned).toBe(0);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(460);
    expect((await remove(orderId,{anonymous:true})).status).toBe(401);
    expect((await remove(orderId,{customer:true})).status).toBe(401);
    expect((await remove(orderId,{cashier:true})).status).toBe(401);
    await rows("UPDATE inventory_usage_rules SET consumeQty=30 WHERE inventoryItemId='beans-test'");
    const removed = await remove(orderId);
    expect(removed.status).toBe(200);
    expect(removed.body.restoredInventory[0]).toMatchObject({qty:40,stockQty:500});
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(4);
    const history = await request('/admin/inventory/item/beans-test/movements?limit=8.9');
    expect(history.status).toBe(200);
    expect(history.body.movements.map((m)=>m.reason)).toEqual(expect.arrayContaining(['order_deletion','deleted_order']));
    expect((await rows('SELECT * FROM print_jobs WHERE orderId=?',[orderId]))).toHaveLength(0);
  });
  it('keeps reward pricing and concurrent repeated deletion consistent', async () => {
    const result = await create(1,true);
    expect(result.status).toBe(200);
    const orderId = result.body.orderId;
    const [order] = await rows('SELECT * FROM orders WHERE id=?',[orderId]);
    expect(Number(order.total)).toBe(5);
    expect(order.loyaltyPointsEarned).toBe(1);
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(5);
    const results = await Promise.all([remove(orderId),remove(orderId)]);
    expect(results.map((r)=>r.status)).toEqual([200,200]);
    expect(results.filter((r)=>r.body.deleted)).toHaveLength(1);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(500);
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(4);
  });
  it('retains cashier checkout and rejects insufficient stock without partial writes', async () => {
    const result = await request('/cashier/orders/create', {method:'POST',cashier:true,body:{items:[{id:'qamar-test',quantity:1}],paymentMethod:'cash'}});
    expect(result.status).toBe(200);
    const [before] = await rows('SELECT COUNT(*) AS count FROM orders');
    const failed = await create(99999);
    expect(failed.status).toBe(409);
    expect((await rows('SELECT COUNT(*) AS count FROM orders'))[0].count).toBe(before.count);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(470);
    expect((await remove(result.body.orderId)).status).toBe(200);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(500);
    expect((await request('/admin/orders/stats')).body.today.revenue).toBe(0);
  });
  it('releases discount usage and never reuses a deleted order number', async () => {
    await rows("UPDATE loyalty_accounts SET points=0 WHERE userId='customer-test'");
    const now = Date.now();
    await rows("INSERT INTO discount_codes (code,name,type,value,usageLimitTotal,active,createdAt,updatedAt) VALUES ('DELETE-TEST','Delete test','fixed',2,1,1,?,?)",[now,now]);
    const checkout = () => request('/orders/create', {method:'POST',customer:true,body:{items:[{id:'qamar-test',quantity:1}],paymentMethod:'cash',discountCode:'DELETE-TEST'}});
    const first = await checkout();
    expect(first.status).toBe(200);
    expect((await checkout()).status).toBeGreaterThanOrEqual(400);
    expect((await remove(first.body.orderId)).status).toBe(200);
    const second = await checkout();
    expect(second.status).toBe(200);
    expect(second.body.orderId).not.toBe(first.body.orderId);
    expect((await remove(second.body.orderId)).status).toBe(200);
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(0);
    expect((await request('/admin/orders/stats')).body.today.revenue).toBe(0);
  });
  it('serializes a new order with deletion for the same customer', async () => {
    const original = await create();
    expect(original.status).toBe(200);
    const [deleted, created] = await Promise.all([remove(original.body.orderId),create()]);
    expect(deleted.status).toBe(200);
    expect(created.status).toBe(200);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(470);
    expect((await rows("SELECT points FROM loyalty_accounts WHERE userId='customer-test'"))[0].points).toBe(1);
    await remove(created.body.orderId);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(500);
  });

  it('prices promotion selections canonically and deducts/restores the chosen drinks', async () => {
    const promo = { count: 2, itemIds: ['qamar-test'], allowDuplicates: true };
    const added = await request('/admin/menu/item', {method:'POST', body:{id:'promo-test',nameEn:'Two drinks',nameAr:'مشروبان',price:9.6,category:'v60',available:true,promotion:promo}});
    expect(added.status).toBe(200);
    const items = [{id:'promo-test',quantity:2,price:0.01,selections:[{id:'qamar-test',temperature:'hot'},{id:'qamar-test',temperature:'iced'}]}];
    const preview = await request('/orders/price-preview', {method:'POST',customer:true,body:{items,language:'en'}});
    expect(preview.status).toBe(200);
    expect(preview.body.pricing.total).toBe(19.2);
    const before = Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty);
    const consume = Number((await rows("SELECT consumeQty FROM inventory_usage_rules WHERE menuItemId='qamar-test'"))[0].consumeQty);
    const created = await request('/orders/create', {method:'POST',customer:true,body:{items,paymentMethod:'cash',language:'en'}});
    expect(created.status).toBe(200);
    const order = (await rows('SELECT items,total FROM orders WHERE id=?',[created.body.orderId]))[0];
    const stored = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    expect(stored[0].components).toHaveLength(2);
    expect(stored[0].nameEn).toContain('Hot');
    expect(stored[0].nameEn).toContain('Iced');
    expect(Number(order.total)).toBe(19.2);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(before - consume * 4);
    expect((await remove(created.body.orderId)).status).toBe(200);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(before);
    for (const selections of [[{id:'qamar-test'}], [{id:'missing'},{id:'qamar-test'}]]) {
      expect((await request('/orders/price-preview',{method:'POST',body:{items:[{id:'promo-test',quantity:1,selections}]}})).status).toBe(400);
    }
    const noTemperature = [{id:'promo-test',quantity:1,selections:[{id:'qamar-test'},{id:'qamar-test'}]}];
    expect((await request('/orders/price-preview',{method:'POST',body:{items:noTemperature}})).status).toBe(400);
    const cashierOrder = await request('/cashier/orders/create',{method:'POST',cashier:true,body:{items,paymentMethod:'cash',language:'ar'}});
    expect(cashierOrder.status).toBe(200);
    expect(cashierOrder.body.order.total).toBe(19.2);
    expect(cashierOrder.body.order.items[0].nameAr).toContain('ساخن');
    await remove(cashierOrder.body.orderId);
    expect(Number((await rows("SELECT stockQty FROM inventory_items WHERE id='beans-test'"))[0].stockQty)).toBe(before);
    const withCoupon = await request('/orders/create',{method:'POST',customer:true,body:{items,discountCode:'TEST',paymentMethod:'cash'}});
    expect(withCoupon.status).toBe(400);
    await rows("UPDATE items SET promotion=? WHERE id='promo-test'",[JSON.stringify({...promo, endsAt:Date.now()-1000})]);
    expect((await request('/orders/price-preview',{method:'POST',body:{items}})).status).toBe(400);
    await rows("UPDATE items SET promotion=? WHERE id='promo-test'",[JSON.stringify(promo)]);
    await rows("UPDATE items SET available=0 WHERE id='qamar-test'");
    expect((await request('/orders/price-preview',{method:'POST',body:{items}})).status).toBe(400);
    await rows("UPDATE items SET available=1 WHERE id='qamar-test'");
  });

});
