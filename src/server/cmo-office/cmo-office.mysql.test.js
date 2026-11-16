// Run only against an isolated database on local MySQL:
// SIGHT_TEST_MYSQL=1 npx vitest run src/server/cmo-office/cmo-office.mysql.test.js
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCmoOfficeAgent } from './agent.js';
import { STARTER_BRAND_NOTES } from './brand.js';
import { CMO_OFFICE_INDEXES, CMO_OFFICE_TABLES } from './schema.js';
import { createCmoOffice } from './telegram.js';

const CHAT_ID = '-100700';
const OWNER = { id: 111, first_name: 'Abdulaziz', username: 'owner' };
const STAFF = { id: 222, first_name: 'Sara', username: 'designer' };

function config(overrides = {}) {
  return {
    enabled: true,
    ready: true,
    chatId: CHAT_ID,
    approverUserIds: [String(OWNER.id)],
    dailyDraftTime: '14:00',
    weeklyDay: 6,
    weeklyTime: '13:00',
    replyMode: 'all',
    maxAttachmentBytes: 20 * 1024 * 1024,
    ...overrides,
  };
}

let nextId = 9000;
function fakeTelegram() {
  const calls = [];
  return {
    calls,
    downloads: [],
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'getMe') return { id: 999, username: 'sight_bot', is_bot: true };
      if (['sendMessage', 'sendPhoto', 'sendDocument'].includes(method)) return { message_id: (nextId += 1) };
      return true;
    },
    async download(fileId) {
      this.downloads.push(fileId);
      return { data: Buffer.from(fileId.startsWith('pdf') ? '%PDF-1.4 fake' : 'fake-png-bytes'), filePath: 'x' };
    },
    sent(method = 'sendMessage') {
      return calls.filter((c) => c.method === method);
    },
  };
}

// Scripted Claude: each create() call consumes one response.
function scriptedClient(responses) {
  const requests = [];
  const create = async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)));
    const next = responses.shift();
    if (!next) throw new Error('No scripted response left');
    return next;
  };
  return { requests, messages: { create }, beta: { messages: { create } } };
}

const toolUse = (id, name, input) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id, name, input }],
  usage: { input_tokens: 10, output_tokens: 5 },
});
const final = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });

let update = 1;
function messageUpdate(from, fields) {
  update += 1;
  return { update_id: update, message: { message_id: update * 10, chat: { id: Number(CHAT_ID), type: 'supergroup' }, from, date: 0, ...fields } };
}
const callback = (from, data, messageId) => ({
  callback_query: { id: `q${(update += 1)}`, from, data, message: { message_id: messageId, chat: { id: Number(CHAT_ID) } } },
});

const suite = process.env.SIGHT_TEST_MYSQL === '1' ? describe : describe.skip;
suite('CMO Office against isolated local MySQL', () => {
  let db;
  let admin;
  const database = `sight_cmo_test_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const host = process.env.MYSQL_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Tests require local MySQL');
    const base = { host, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '' };
    admin = await mysql.createConnection(base);
    await admin.query(`CREATE DATABASE \`${database}\``);
    db = mysql.createPool({ ...base, database, connectionLimit: 5 });
    await db.query('CREATE TABLE app_settings (`key` VARCHAR(64) PRIMARY KEY, `value` TEXT NOT NULL, updatedAt BIGINT NOT NULL)');
    await db.query(`CREATE TABLE agent_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, channel VARCHAR(32), externalIdHash CHAR(64), requestId VARCHAR(128), model VARCHAR(128), status VARCHAR(32), inputChars INT, outputChars INT, toolCalls JSON, usageJson JSON, errorCode VARCHAR(128), createdAt BIGINT)`);
    await db.query('CREATE TABLE categories (id VARCHAR(64) PRIMARY KEY, nameEn VARCHAR(255), nameAr VARCHAR(255), `order` INT, iconUrl VARCHAR(1024))');
    await db.query('CREATE TABLE items (id VARCHAR(64) PRIMARY KEY, nameEn VARCHAR(255), nameAr VARCHAR(255), price DECIMAL(10,2), category VARCHAR(64), description TEXT, descriptionEn TEXT, descriptionAr TEXT, imageUrl VARCHAR(1024), available TINYINT(1))');
    await db.query("INSERT INTO categories VALUES ('coffee', 'Coffee', 'قهوة', 1, NULL)");
    await db.query("INSERT INTO items VALUES ('v60', 'V60 Qamar Aldeen', 'في ٦٠ قمر الدين', 22, 'coffee', NULL, 'Peach, apricot', NULL, NULL, 1), ('old', 'Old drink', 'قديم', 10, 'coffee', NULL, NULL, NULL, NULL, 0)");
    for (const sql of CMO_OFFICE_TABLES) await db.query(sql);
    for (const sql of CMO_OFFICE_INDEXES) await db.query(sql);
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin?.end();
  });

  function office(responses, overrides, { model = 'claude-opus-5-5', at = '2026-11-16T11:05:00Z' } = {}) {
    const telegram = fakeTelegram();
    const client = scriptedClient(responses);
    const now = () => new Date(at); // 14:05 in Riyadh, a Monday
    const agent = createCmoOfficeAgent({ client, db, model, effort: 'medium', now });
    return { telegram, client, cmo: createCmoOffice({ db, telegram, agent, config: config(overrides), now }) };
  }

  it('seeds starter brand notes once and puts them in the prompt', async () => {
    const { cmo, client } = office([final('مرحبا')]);
    await cmo.init();
    await cmo.init();
    const [[row]] = await db.query("SELECT COUNT(*) AS n FROM cmo_brand_notes WHERE status = 'active'");
    expect(Number(row.n)).toBe(STARTER_BRAND_NOTES.length);
    await cmo.handleUpdate(messageUpdate(OWNER, { text: 'hi' })).work;
    const request = client.requests[0];
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(request.fallbacks).toBe('default');
    expect(request.output_config).toEqual({ effort: 'medium' });
    expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(request.system[1].text).toContain('Calm. Minimal. Knowledgeable. Warm.');
    expect(request.system[1].text).toContain('OWNER/APPROVER');
    expect(request.system[1].text).toContain('Monday 2026-11-16');
  });

  it('stores a Canva upload, shows it to Claude and catalogues it', async () => {
    const { cmo, telegram, client } = office([
      toolUse('t1', 'update_asset', {
        assetId: 1,
        title: 'V60 night story',
        assetType: 'story',
        description: 'Black background, V60 cup, text "الليلة نشوفكم"',
        tags: ['v60', 'night'],
        language: 'ar',
        menuItems: ['V60 Qamar Aldeen'],
        campaign: null,
      }),
      final('Saved the V60 night story (#1).'),
    ]);
    await cmo.handleUpdate(
      messageUpdate(STAFF, {
        caption: 'story template for V60 nights',
        document: { file_id: 'png-1', file_unique_id: 'u1', file_name: 'v60.png', mime_type: 'image/png', file_size: 2000 },
      })
    ).work;
    expect(telegram.downloads).toEqual(['png-1']);
    const [[asset]] = await db.query('SELECT * FROM cmo_assets WHERE id = 1');
    expect(asset).toMatchObject({ kind: 'document', mimeType: 'image/png', assetType: 'story', title: 'V60 night story', uploadedByName: 'Sara' });
    expect(Buffer.from(asset.data).toString()).toBe('fake-png-bytes');
    const user = client.requests[0].messages.at(-1).content;
    expect(user[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(user[1].text).toContain('asset #1');
    // The tool loop sends Claude's full content (thinking included) back, then the tool result.
    expect(client.requests[1].messages.at(-2).content[0].type).toBe('thinking');
    expect(client.requests[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(telegram.sent()[0].payload.text).toContain('Saved the V60');
  });

  it('sends PDFs (brand book) to Claude as documents', async () => {
    const { cmo, client } = office([final('NO_REPLY')]);
    await cmo.handleUpdate(
      messageUpdate(OWNER, { caption: 'brand book', document: { file_id: 'pdf-1', file_name: 'brand.pdf', mime_type: 'application/pdf', file_size: 100 } })
    ).work;
    const user = client.requests[0].messages.at(-1).content;
    expect(user[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
  });

  it('saves brand notes: owner notes are active, staff notes are suggestions, owner-only tools are refused for staff', async () => {
    const staff = office([
      toolUse('n1', 'add_brand_note', { category: 'dont', note: 'Never use the word cheap.' }),
      toolUse('n2', 'set_brand_note_status', { noteId: 1, status: 'archived' }),
      final('Noted as a suggestion for the owner.'),
    ]);
    await staff.cmo.handleUpdate(messageUpdate(STAFF, { text: 'never say cheap' })).work;
    const owner = office([toolUse('n3', 'add_brand_note', { category: 'platform', note: 'Stories every day at 3 PM.' }), final('NO_REPLY')]);
    await owner.cmo.handleUpdate(messageUpdate(OWNER, { text: 'stories daily at 3' })).work;
    const [notes] = await db.query("SELECT note, status, createdByName FROM cmo_brand_notes WHERE source = 'chat' ORDER BY id");
    expect(notes).toEqual([
      { note: 'Never use the word cheap.', status: 'suggested', createdByName: 'Sara' },
      { note: 'Stories every day at 3 PM.', status: 'active', createdByName: 'Abdulaziz' },
    ]);
    const refused = staff.client.requests[2].messages.at(-1).content[0];
    expect(refused.is_error).toBe(true);
    const [[first]] = await db.query('SELECT status FROM cmo_brand_notes WHERE id = 1');
    expect(first.status).toBe('active');
  });

  it('proposes posts with real menu data, posts cards, and only the owner approves', async () => {
    const { cmo, telegram, client } = office([
      toolUse('m1', 'get_menu', { availableOnly: true }),
      toolUse('p1', 'propose_posts', {
        proposals: [
          { proposalType: 'story', platform: 'instagram', scheduledDate: '2026-11-16', scheduledTime: '15:00', assetId: 1, title: 'Open tonight', captionAr: 'الليلة نشوفكم 🌙', captionEn: 'Tonight, 4 PM to 2 AM.', hashtags: '#الاحساء', rationale: 'V60 sold most last week', visualBrief: null },
          { proposalType: 'post', platform: 'instagram', scheduledDate: '2026-11-17', scheduledTime: null, assetId: 999, title: 'Qamar Aldeen', captionAr: 'قمر الدين', captionEn: null, hashtags: null, rationale: 'Push V60', visualBrief: 'Close-up of the cup' },
        ],
      }),
      final('Two drafts for today and tomorrow.'),
    ]);
    await cmo.handleUpdate(messageUpdate(STAFF, { text: 'what should we post?' })).work;

    const menu = JSON.parse(client.requests[1].messages.at(-1).content[0].content);
    expect(menu.items.map((i) => i.nameEn)).toEqual(['V60 Qamar Aldeen']);

    const [proposals] = await db.query('SELECT * FROM cmo_proposals ORDER BY id');
    expect(proposals).toHaveLength(2);
    expect(proposals[1].assetId).toBeNull(); // unknown asset dropped
    expect(proposals.every((p) => p.status === 'pending' && p.approvalTelegramMessageId != null)).toBe(true);
    expect(Number(proposals[0].batchId)).toBe(Number(proposals[0].id));

    expect(telegram.sent('sendDocument')[0].payload.document).toBe('png-1'); // design sent before its card
    const texts = telegram.sent().map((c) => c.payload.text);
    expect(texts[0]).toBe('Two drafts for today and tomorrow.');
    expect(texts[1]).toContain('📝 Draft #');
    expect(texts[1]).toContain('🎨 Design: #1 V60 night story');
    expect(texts[2]).toContain('🎨 Needs a design: Close-up of the cup');
    const batchButton = telegram.sent().at(-1).payload.reply_markup.inline_keyboard[0][0];
    expect(batchButton.callback_data).toBe(`cmo:ab:${proposals[0].id}`);

    expect(await cmo.handleUpdate(callback(STAFF, `cmo:a:${proposals[0].id}`, 1)).work).toEqual({ denied: true });
    expect(await cmo.handleUpdate(callback(OWNER, `cmo:r:${proposals[1].id}`, 1)).work).toEqual({ changed: 1 });
    expect(await cmo.handleUpdate(callback(OWNER, batchButton.callback_data, 1)).work).toEqual({ changed: 1 });
    const [after] = await db.query('SELECT status, reviewedByName FROM cmo_proposals ORDER BY id');
    expect(after).toEqual([
      { status: 'approved', reviewedByName: 'Abdulaziz' },
      { status: 'rejected', reviewedByName: 'Abdulaziz' },
    ]);
    const edits = telegram.calls.filter((c) => c.method === 'editMessageText');
    expect(edits[0].payload.text).toContain('❌ Rejected');
    expect(edits[1].payload.text).toContain('✅ Approved by Abdulaziz');
    expect(edits[1].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`cmo:p:${proposals[0].id}`);

    // Staff mark the approved post as published; a rejected one cannot be.
    expect(await cmo.handleUpdate(callback(STAFF, `cmo:p:${proposals[0].id}`, 1)).work).toEqual({ published: true });
    expect(await cmo.handleUpdate(callback(STAFF, `cmo:p:${proposals[1].id}`, 1)).work).toEqual({ published: false });

    // A reply to the rejected card is linked to that draft.
    const followUp = office([final('Revised.')]);
    await followUp.cmo.handleUpdate(
      messageUpdate(OWNER, { text: 'make it shorter', reply_to_message: { message_id: Number(proposals[1].approvalTelegramMessageId) } })
    ).work;
    expect(followUp.client.requests[0].messages.at(-1).content.at(-1).text).toContain(`replies to draft #${proposals[1].id}`);
  });

  it('runs the daily draft once per day and the weekly plan on its day', async () => {
    const { cmo, client } = office([final('NO_REPLY'), final('NO_REPLY')], {}, { at: '2026-11-21T10:05:00Z' }); // Saturday 13:05
    expect(await cmo.runSchedule(new Date('2026-11-21T10:05:00Z'))).toEqual(['weekly']);
    expect(await cmo.runSchedule(new Date('2026-11-21T11:05:00Z'))).toEqual(['daily']);
    expect(await cmo.runSchedule(new Date('2026-11-21T12:05:00Z'))).toEqual([]);
    expect(client.requests[0].messages.at(-1).content.at(-1).text).toContain('plan the next 7 days');
    expect(client.requests[1].messages.at(-1).content.at(-1).text).toContain('open tonight');
  });

  it('uses the plain endpoint for models without server-side fallbacks', async () => {
    const { cmo, client } = office([final('ok')], {}, { model: 'claude-haiku-5-5' });
    await cmo.handleUpdate(messageUpdate(OWNER, { text: 'hello' })).work;
    expect(client.requests[0].betas).toBeUndefined();
    expect(client.requests[0].fallbacks).toBeUndefined();
  });

  it('ignores re-delivered updates and answers /cmo_setup in other chats', async () => {
    const { cmo, client } = office([final('ok')]);
    const repeated = messageUpdate(STAFF, { text: 'hello team' });
    await cmo.handleUpdate(repeated).work;
    expect(await cmo.handleUpdate(repeated).work).toEqual({ duplicate: true });
    expect(client.requests).toHaveLength(1);
    expect(cmo.handleUpdate({ message: { chat: { id: 5 }, from: OWNER, text: 'hello' } }).handled).toBe(false);
    expect(cmo.handleUpdate({ message: { chat: { id: 5 }, from: OWNER, text: '/cmo_setup' } }).handled).toBe(true);
  });
});
