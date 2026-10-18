// Run only against an isolated database on local MySQL:
// SIGHT_TEST_MYSQL=1 npx vitest run src/server/cfo-office/cfo-office.mysql.test.js
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCfoOfficeAgent } from './agent.js';
import { CFO_OFFICE_INDEXES, CFO_OFFICE_TABLES } from './schema.js';
import { CFO_STARTER_QUESTIONS } from './questions.js';
import { createCfoOffice } from './telegram.js';

const CHAT_ID = '-100500';
const OWNER = { id: 111, first_name: 'Abdulaziz', username: 'owner' };
const STAFF = { id: 222, first_name: 'Sara', username: 'barista' };

function config(overrides = {}) {
  return {
    enabled: true,
    ready: true,
    chatId: CHAT_ID,
    approverUserIds: [String(OWNER.id)],
    questionTimes: ['10:00', '17:00'],
    questionsPerRound: 2,
    replyMode: 'all',
    maxAttachmentBytes: 10 * 1024 * 1024,
    ...overrides,
  };
}

let nextId = 9000; // Telegram message ids are unique per chat
function fakeTelegram() {
  const calls = [];
  return {
    calls,
    downloads: [],
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'getMe') return { id: 999, username: 'sight_cfo_bot', is_bot: true };
      if (method === 'sendMessage') return { message_id: (nextId += 1) };
      return true;
    },
    async download(fileId) {
      this.downloads.push(fileId);
      return { data: Buffer.from('fake-jpeg-bytes'), filePath: 'photos/x.jpg' };
    },
    sent() {
      return calls.filter((c) => c.method === 'sendMessage');
    },
  };
}

// Scripted Grok: each handle() consumes one script entry (array of completions).
function scriptedClient(scripts) {
  const requests = [];
  return {
    requests,
    chat: {
      completions: {
        create: async (request) => {
          requests.push(JSON.parse(JSON.stringify(request)));
          const next = scripts.shift();
          if (!next) throw new Error('No scripted completion left');
          return next;
        },
      },
    },
  };
}

const toolCall = (id, name, args) => ({
  choices: [{ message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});
const final = (content) => ({ choices: [{ message: { content } }] });

let update = 1;
function messageUpdate(from, fields) {
  update += 1;
  return { update_id: update, message: { message_id: update * 10, chat: { id: Number(CHAT_ID), type: 'supergroup' }, from, date: 0, ...fields } };
}

const suite = process.env.SIGHT_TEST_MYSQL === '1' ? describe : describe.skip;
suite('CFO Office against isolated local MySQL', () => {
  let db;
  let admin;
  const database = `sight_cfo_test_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const host = process.env.MYSQL_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Tests require local MySQL');
    const base = { host, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' };
    admin = await mysql.createConnection(base);
    await admin.query(`CREATE DATABASE \`${database}\``);
    db = mysql.createPool({ ...base, database, connectionLimit: 5 });
    await db.query('CREATE TABLE app_settings (`key` VARCHAR(64) PRIMARY KEY, `value` TEXT NOT NULL, updatedAt BIGINT NOT NULL)');
    await db.query(`CREATE TABLE agent_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, channel VARCHAR(32), externalIdHash CHAR(64), requestId VARCHAR(128), model VARCHAR(128), status VARCHAR(32), inputChars INT, outputChars INT, toolCalls JSON, usageJson JSON, errorCode VARCHAR(128), createdAt BIGINT)`);
    for (const sql of CFO_OFFICE_TABLES) await db.query(sql);
    for (const sql of CFO_OFFICE_INDEXES) await db.query(sql);
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin?.end();
  });

  function office(scripts, overrides) {
    const telegram = fakeTelegram();
    const client = scriptedClient(scripts);
    const now = () => new Date('2026-10-18T07:05:00Z'); // 10:05 in Riyadh
    const agent = createCfoOfficeAgent({ client, db, model: 'grok-test', now });
    return { telegram, client, cfo: createCfoOffice({ db, telegram, agent, config: config(overrides), now }) };
  }

  it('seeds the starter questions once', async () => {
    const { cfo } = office([]);
    await cfo.init();
    await cfo.init();
    const [[row]] = await db.query("SELECT COUNT(*) AS n FROM cfo_questions WHERE status = 'open'");
    expect(Number(row.n)).toBe(CFO_STARTER_QUESTIONS.length);
  });

  it('records staff data as pending, posts approval buttons, and the owner approves', async () => {
    const { cfo, telegram, client } = office([
      toolCall('c1', 'save_records', {
        records: [
          { recordType: 'purchase', description: 'Beans from Roastery X', amount: 920, vatAmount: 120, counterparty: 'Roastery X', recordDate: null },
          { recordType: 'ingredient_cost', description: 'Espresso beans', quantity: 2, unit: 'kg', unitCost: 400, category: 'beans', questionKey: 'ingredient_costs' },
        ],
      }),
      toolCall('c2', 'update_question', { questionKey: 'ingredient_costs', status: 'open', answerSummary: 'Beans 400 SAR/kg' }),
      final('Recorded the beans purchase (920 SAR) and 400 SAR/kg. What do we pay for milk per liter?'),
    ]);
    const result = cfo.handleUpdate(messageUpdate(STAFF, { text: 'Bought 2kg beans from Roastery X, 920 with VAT' }));
    expect(result.handled).toBe(true);
    await result.work;

    const [records] = await db.query('SELECT * FROM cfo_records ORDER BY id');
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.status === 'pending' && r.submittedByName === 'Sara')).toBe(true);
    expect(records[0].recordDate).toBe('2026-10-18');

    const sent = telegram.sent();
    expect(sent[0].payload.text).toContain('400 SAR/kg');
    const approval = sent[1].payload;
    expect(approval.reply_markup.inline_keyboard.at(-1)[0].callback_data).toBe('cfo:aa');
    expect(records.every((r) => r.approvalTelegramMessageId != null)).toBe(true);

    const system = client.requests[0].messages[0].content;
    expect(system).toContain('not an approver');
    expect(client.requests[0].tools.map((t) => t.function.name)).toContain('save_records');

    // Staff cannot approve
    const approvalMessageId = Number(records[0].approvalTelegramMessageId);
    const denied = cfo.handleUpdate({ callback_query: { id: 'q1', from: STAFF, data: 'cfo:aa', message: { message_id: approvalMessageId, chat: { id: Number(CHAT_ID) } } } });
    expect(await denied.work).toEqual({ denied: true });

    const approved = cfo.handleUpdate({ callback_query: { id: 'q2', from: OWNER, data: 'cfo:aa', message: { message_id: approvalMessageId, chat: { id: Number(CHAT_ID) } } } });
    expect(await approved.work).toEqual({ changed: 2 });
    const [after] = await db.query('SELECT status, reviewedByName FROM cfo_records ORDER BY id');
    expect(after.every((r) => r.status === 'confirmed' && r.reviewedByName === 'Abdulaziz')).toBe(true);
    const edit = telegram.calls.find((c) => c.method === 'editMessageText');
    expect(edit.payload.text).toContain('✅ #');
    expect(edit.payload.reply_markup.inline_keyboard).toHaveLength(0);
  });

  it('ignores a re-delivered Telegram update', async () => {
    const { cfo, client } = office([final('ok')]);
    const repeated = messageUpdate(STAFF, { text: 'Fuel 150 today' });
    await cfo.handleUpdate(repeated).work;
    expect(await cfo.handleUpdate(repeated).work).toEqual({ duplicate: true });
    expect(client.requests).toHaveLength(1);
  });

  it('confirms owner records immediately and stays quiet on NO_REPLY', async () => {
    const { cfo, telegram } = office([
      toolCall('c1', 'save_records', { records: [{ recordType: 'fixed_cost', description: 'Parking rent', amount: 1500, frequency: 'monthly' }] }),
      final('NO_REPLY'),
    ]);
    await cfo.handleUpdate(messageUpdate(OWNER, { text: 'parking is 1500 a month' })).work;
    const [[row]] = await db.query("SELECT status, frequency FROM cfo_records WHERE description = 'Parking rent'");
    expect(row).toEqual({ status: 'confirmed', frequency: 'monthly' });
    expect(telegram.sent()).toHaveLength(0);
  });

  it('stores receipt photos and sends them to Grok as images', async () => {
    const { cfo, telegram, client } = office([final('Got the receipt.')]);
    await cfo.handleUpdate(
      messageUpdate(STAFF, { caption: 'milk bill', photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'big', file_unique_id: 'u1', file_size: 2000 }] })
    ).work;
    expect(telegram.downloads).toEqual(['big']);
    const [[attachment]] = await db.query("SELECT kind, mimeType, data FROM cfo_attachments WHERE telegramFileId = 'big'");
    expect(attachment.kind).toBe('photo');
    expect(Buffer.from(attachment.data).toString()).toBe('fake-jpeg-bytes');
    const user = client.requests[0].messages.at(-1).content;
    expect(user[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('asks scheduled questions once per slot and links replies to them', async () => {
    const { cfo, telegram } = office([]);
    expect(await cfo.runSchedule(new Date('2026-10-18T07:05:00Z'))).toBe(2);
    expect(await cfo.runSchedule(new Date('2026-10-18T07:30:00Z'))).toBe(0);
    const asked = telegram.sent();
    expect(asked[0].payload.text).toContain('CFO Office question');

    const [[question]] = await db.query("SELECT questionKey, telegramMessageId FROM cfo_messages WHERE direction = 'out' AND questionKey IS NOT NULL ORDER BY id LIMIT 1");
    const followUp = office([final('Thanks!')]);
    await followUp.cfo.handleUpdate(
      messageUpdate(STAFF, { text: 'here you go', reply_to_message: { message_id: Number(question.telegramMessageId) } })
    ).work;
    expect(followUp.client.requests[0].messages[0].content).toContain(`reply to question [${question.questionKey}]`);
  });

  it('answers /cfo_setup in other chats and ignores unrelated chats', () => {
    const { cfo } = office([]);
    expect(cfo.handleUpdate({ message: { chat: { id: 5 }, from: OWNER, text: 'hello' } }).handled).toBe(false);
    expect(cfo.handleUpdate({ message: { chat: { id: 5 }, from: OWNER, text: '/cfo_setup' } }).handled).toBe(true);
  });
});
