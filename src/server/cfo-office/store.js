import { CFO_STARTER_QUESTIONS } from './questions.js';

export const RECORD_TYPES = [
  'expense',
  'purchase',
  'ingredient_cost',
  'fixed_cost',
  'staff',
  'salary',
  'cash_count',
  'bank_balance',
  'income_other',
  'loan',
  'investment',
  'supplier',
  'payment_provider',
  'tax_info',
  'target',
  'fact',
];
export const FREQUENCIES = ['one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
const RECORD_STATUSES = ['pending', 'confirmed', 'rejected'];
const QUESTION_STATUSES = ['open', 'answered', 'skipped'];
const REASK_AFTER_MS = 20 * 60 * 60 * 1000;

function text(value, max) {
  if (value == null) return null;
  const result = String(value).trim();
  if (!result) return null;
  return max ? result.slice(0, max) : result;
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export async function seedCfoQuestions(db, now = Date.now()) {
  for (const question of CFO_STARTER_QUESTIONS) {
    await db.execute(
      `INSERT IGNORE INTO cfo_questions
         (questionKey, topic, audience, priority, questionEn, questionAr, source, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'starter', 'open', ?, ?)`,
      [question.key, question.topic, question.audience, question.priority, question.en, question.ar, now, now]
    );
  }
}

export async function upsertMember(db, { userId, displayName, username, isApprover }, now = Date.now()) {
  if (!userId) return;
  await db.execute(
    `INSERT INTO cfo_members (telegramUserId, displayName, username, isApprover, firstSeenAt, lastSeenAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       displayName = VALUES(displayName),
       username = VALUES(username),
       isApprover = VALUES(isApprover),
       lastSeenAt = VALUES(lastSeenAt)`,
    [String(userId), text(displayName, 255) || 'Unknown', text(username, 64), isApprover ? 1 : 0, now, now]
  );
}

export async function listMembers(db) {
  const [rows] = await db.execute(
    `SELECT telegramUserId, displayName, username, role, notes, isApprover, lastSeenAt
     FROM cfo_members ORDER BY lastSeenAt DESC LIMIT 50`
  );
  return rows.map((row) => ({
    telegramUserId: String(row.telegramUserId),
    displayName: row.displayName,
    username: row.username || null,
    role: row.role || null,
    notes: row.notes || null,
    isApprover: Boolean(Number(row.isApprover)),
  }));
}

export async function setMemberRole(db, { telegramUserId, role, notes }) {
  const [result] = await db.execute(
    `UPDATE cfo_members SET role = ?, notes = COALESCE(?, notes) WHERE telegramUserId = ?`,
    [text(role, 64), text(notes, 2000), String(telegramUserId || '')]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function saveAttachment(db, attachment, now = Date.now()) {
  const [result] = await db.execute(
    `INSERT INTO cfo_attachments
       (chatId, telegramFileId, telegramFileUniqueId, kind, fileName, mimeType, byteSize, data, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(attachment.chatId),
      String(attachment.telegramFileId),
      text(attachment.telegramFileUniqueId, 128),
      attachment.kind,
      text(attachment.fileName, 255),
      text(attachment.mimeType, 128),
      attachment.byteSize ?? null,
      attachment.data ?? null,
      now,
    ]
  );
  return Number(result.insertId);
}

// Returns null when Telegram re-delivers an update we already stored.
export async function saveMessage(db, message, now = Date.now()) {
  const [result] = await db.execute(
    `INSERT IGNORE INTO cfo_messages
       (chatId, telegramMessageId, direction, fromUserId, fromName, messageType, text,
        attachmentId, replyToTelegramMessageId, questionKey, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(message.chatId),
      message.telegramMessageId ?? null,
      message.direction,
      message.fromUserId != null ? String(message.fromUserId) : null,
      text(message.fromName, 255),
      message.messageType || 'text',
      text(message.text),
      message.attachmentId ?? null,
      message.replyToTelegramMessageId ?? null,
      text(message.questionKey, 64),
      now,
    ]
  );
  if (Number(result?.affectedRows || 0) === 0) return null;
  return Number(result.insertId);
}

export async function getRecentMessages(db, chatId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const [rows] = await db.execute(
    `SELECT id, direction, fromName, messageType, text, questionKey, createdAt
     FROM cfo_messages WHERE chatId = ?
     ORDER BY createdAt DESC, id DESC LIMIT ${safeLimit}`,
    [String(chatId)]
  );
  return rows.reverse();
}

export async function findAskedQuestion(db, chatId, telegramMessageId) {
  if (telegramMessageId == null) return null;
  const [rows] = await db.execute(
    `SELECT q.questionKey, q.questionEn, q.status
     FROM cfo_messages m JOIN cfo_questions q ON q.questionKey = m.questionKey
     WHERE m.chatId = ? AND m.telegramMessageId = ? AND m.direction = 'out'
     LIMIT 1`,
    [String(chatId), telegramMessageId]
  );
  return rows?.[0] || null;
}

export function normalizeRecord(input, defaults = {}) {
  const recordType = RECORD_TYPES.includes(input?.recordType) ? input.recordType : 'fact';
  const description = text(input?.description, 2000);
  if (!description) throw new Error('Each record needs a description');
  const frequency = FREQUENCIES.includes(input?.frequency) ? input.frequency : null;
  const details = input?.details && typeof input.details === 'object' ? input.details : null;
  return {
    recordType,
    recordDate: dateKey(input?.recordDate) || defaults.recordDate || null,
    description,
    category: text(input?.category, 64),
    counterparty: text(input?.counterparty, 255),
    amount: number(input?.amount),
    vatAmount: number(input?.vatAmount),
    currency: (text(input?.currency, 8) || 'SAR').toUpperCase(),
    quantity: number(input?.quantity),
    unit: text(input?.unit, 32),
    unitCost: number(input?.unitCost),
    frequency,
    paymentMethod: text(input?.paymentMethod, 32),
    inventoryItemId: text(input?.inventoryItemId, 64),
    staffMemberName: text(input?.staffMemberName, 255),
    questionKey: text(input?.questionKey, 64),
    details,
  };
}

export async function insertRecord(db, record, meta, now = Date.now()) {
  const status = meta.autoConfirm ? 'confirmed' : 'pending';
  const [result] = await db.execute(
    `INSERT INTO cfo_records
       (recordType, status, recordDate, description, category, counterparty, amount, vatAmount,
        currency, quantity, unit, unitCost, frequency, paymentMethod, inventoryItemId,
        staffMemberName, questionKey, details, sourceMessageId, attachmentId,
        submittedByUserId, submittedByName, reviewedByUserId, reviewedByName, reviewedAt,
        createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.recordType,
      status,
      record.recordDate,
      record.description,
      record.category,
      record.counterparty,
      record.amount,
      record.vatAmount,
      record.currency,
      record.quantity,
      record.unit,
      record.unitCost,
      record.frequency,
      record.paymentMethod,
      record.inventoryItemId,
      record.staffMemberName,
      record.questionKey,
      record.details ? JSON.stringify(record.details) : null,
      meta.sourceMessageId ?? null,
      meta.attachmentId ?? null,
      meta.submittedByUserId != null ? String(meta.submittedByUserId) : null,
      text(meta.submittedByName, 255),
      meta.autoConfirm ? String(meta.submittedByUserId) : null,
      meta.autoConfirm ? text(meta.submittedByName, 255) : null,
      meta.autoConfirm ? now : null,
      now,
      now,
    ]
  );
  return { id: Number(result.insertId), status };
}

export async function attachApprovalMessage(db, recordIds, telegramMessageId) {
  if (!recordIds.length) return;
  await db.execute(
    `UPDATE cfo_records SET approvalTelegramMessageId = ?
     WHERE id IN (${recordIds.map(() => '?').join(',')})`,
    [telegramMessageId, ...recordIds]
  );
}

export async function reviewRecord(db, id, { status, reviewerId, reviewerName }, now = Date.now()) {
  if (!['confirmed', 'rejected'].includes(status)) throw new Error('Invalid review status');
  const [result] = await db.execute(
    `UPDATE cfo_records
     SET status = ?, reviewedByUserId = ?, reviewedByName = ?, reviewedAt = ?, updatedAt = ?
     WHERE id = ? AND status = 'pending'`,
    [status, String(reviewerId), text(reviewerName, 255), now, now, Number(id)]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function getRecord(db, id) {
  const [rows] = await db.execute(`SELECT * FROM cfo_records WHERE id = ? LIMIT 1`, [Number(id)]);
  return rows?.[0] || null;
}

export async function listPendingRecords(db, { approvalTelegramMessageId, limit = 25 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const params = [];
  let where = `status = 'pending'`;
  if (approvalTelegramMessageId != null) {
    where += ' AND approvalTelegramMessageId = ?';
    params.push(approvalTelegramMessageId);
  }
  const [rows] = await db.execute(
    `SELECT * FROM cfo_records WHERE ${where} ORDER BY id ASC LIMIT ${safeLimit}`,
    params
  );
  return rows;
}

export async function queryRecords(db, filters = {}) {
  const where = [];
  const params = [];
  if (RECORD_TYPES.includes(filters.recordType)) {
    where.push('recordType = ?');
    params.push(filters.recordType);
  }
  if (RECORD_STATUSES.includes(filters.status)) {
    where.push('status = ?');
    params.push(filters.status);
  } else {
    where.push(`status <> 'rejected'`);
  }
  if (dateKey(filters.fromDate)) {
    where.push('(recordDate IS NULL OR recordDate >= ?)');
    params.push(filters.fromDate);
  }
  if (dateKey(filters.toDate)) {
    where.push('(recordDate IS NULL OR recordDate <= ?)');
    params.push(filters.toDate);
  }
  if (text(filters.search)) {
    where.push('(description LIKE ? OR counterparty LIKE ? OR category LIKE ?)');
    const like = `%${text(filters.search, 100)}%`;
    params.push(like, like, like);
  }
  const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `SELECT id, recordType, status, recordDate, description, category, counterparty, amount,
            vatAmount, currency, quantity, unit, unitCost, frequency, paymentMethod,
            inventoryItemId, staffMemberName, questionKey, submittedByName, createdAt
     FROM cfo_records ${clause} ORDER BY COALESCE(recordDate, '') DESC, id DESC LIMIT ${safeLimit}`,
    params
  );
  const [totals] = await db.execute(
    `SELECT recordType, status, COUNT(*) AS records, SUM(amount) AS amount, SUM(vatAmount) AS vatAmount
     FROM cfo_records ${clause} GROUP BY recordType, status`,
    params
  );
  return {
    records: rows.map((row) => ({
      ...row,
      amount: number(row.amount),
      vatAmount: number(row.vatAmount),
      quantity: number(row.quantity),
      unitCost: number(row.unitCost),
    })),
    totals: totals.map((row) => ({
      recordType: row.recordType,
      status: row.status,
      records: Number(row.records),
      amount: number(row.amount),
      vatAmount: number(row.vatAmount),
    })),
  };
}

export async function listQuestions(db, status) {
  const params = [];
  let where = '';
  if (QUESTION_STATUSES.includes(status)) {
    where = 'WHERE status = ?';
    params.push(status);
  }
  const [rows] = await db.execute(
    `SELECT questionKey, topic, audience, priority, questionEn, questionAr, status, timesAsked,
            lastAskedAt, answerSummary
     FROM cfo_questions ${where} ORDER BY priority ASC, questionKey ASC`,
    params
  );
  return rows;
}

export async function updateQuestion(db, { questionKey, status, answerSummary }, now = Date.now()) {
  if (!QUESTION_STATUSES.includes(status)) throw new Error('Invalid question status');
  const [result] = await db.execute(
    `UPDATE cfo_questions
     SET status = ?, answerSummary = COALESCE(?, answerSummary),
         answeredAt = CASE WHEN ? = 'answered' THEN ? ELSE answeredAt END, updatedAt = ?
     WHERE questionKey = ?`,
    [status, text(answerSummary, 4000), status, now, now, String(questionKey || '')]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function addQuestion(db, { topic, audience, priority, questionEn, questionAr }, now = Date.now()) {
  const en = text(questionEn, 2000);
  if (!en) throw new Error('questionEn is required');
  const key = `followup_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await db.execute(
    `INSERT INTO cfo_questions
       (questionKey, topic, audience, priority, questionEn, questionAr, source, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'agent', 'open', ?, ?)`,
    [
      key,
      text(topic, 32) || 'general',
      ['owner', 'staff', 'any'].includes(audience) ? audience : 'any',
      Math.min(Math.max(Number(priority) || 50, 1), 200),
      en,
      text(questionAr, 2000),
      now,
      now,
    ]
  );
  return key;
}

export async function pickQuestionsToAsk(db, count, now = Date.now()) {
  const safeCount = Math.min(Math.max(Number(count) || 1, 1), 5);
  const [rows] = await db.execute(
    `SELECT questionKey, topic, audience, priority, questionEn, questionAr, timesAsked
     FROM cfo_questions
     WHERE status = 'open' AND (lastAskedAt IS NULL OR lastAskedAt < ?)
     ORDER BY timesAsked ASC, priority ASC, questionKey ASC
     LIMIT ${safeCount}`,
    [now - REASK_AFTER_MS]
  );
  return rows;
}

export async function markQuestionAsked(db, questionKey, now = Date.now()) {
  await db.execute(
    `UPDATE cfo_questions SET timesAsked = timesAsked + 1, lastAskedAt = ?, updatedAt = ?
     WHERE questionKey = ?`,
    [now, now, questionKey]
  );
}

export async function getOfficeSummary(db) {
  const [questions] = await db.execute(
    `SELECT status, COUNT(*) AS total FROM cfo_questions GROUP BY status`
  );
  const [records] = await db.execute(
    `SELECT recordType, status, COUNT(*) AS total FROM cfo_records GROUP BY recordType, status`
  );
  const [messages] = await db.execute(
    `SELECT COUNT(*) AS total, SUM(attachmentId IS NOT NULL) AS withFiles FROM cfo_messages WHERE direction = 'in'`
  );
  return {
    questions: Object.fromEntries(questions.map((row) => [row.status, Number(row.total)])),
    records: records.map((row) => ({
      recordType: row.recordType,
      status: row.status,
      total: Number(row.total),
    })),
    messagesReceived: Number(messages?.[0]?.total || 0),
    filesReceived: Number(messages?.[0]?.withFiles || 0),
  };
}

export async function listRecordsByApprovalMessage(db, approvalTelegramMessageId) {
  const [rows] = await db.execute(
    `SELECT * FROM cfo_records WHERE approvalTelegramMessageId = ? ORDER BY id ASC`,
    [approvalTelegramMessageId]
  );
  return rows;
}
