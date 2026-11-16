import { STARTER_BRAND_NOTES } from './brand.js';

export const ASSET_TYPES = [
  'post',
  'story',
  'reel_cover',
  'menu',
  'promo',
  'logo',
  'brand_book',
  'photo',
  'reference',
  'template',
  'other',
];
export const NOTE_CATEGORIES = ['voice', 'language', 'visual', 'audience', 'platform', 'campaign', 'do', 'dont', 'fact'];
export const PROPOSAL_TYPES = ['post', 'story', 'reel', 'broadcast_idea', 'campaign_idea'];
export const PLATFORMS = ['instagram', 'snapchat', 'tiktok', 'x', 'whatsapp', 'google_maps', 'in_truck', 'other'];

function text(value, max) {
  if (value == null) return null;
  const result = String(value).trim();
  if (!result) return null;
  return max ? result.slice(0, max) : result;
}

function dateKey(value) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function timeKey(value) {
  const raw = text(value);
  return raw && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

function stringList(value, maxItems = 20, maxLength = 64) {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems);
  return items.length ? items : null;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------- brand notes ----------

export async function seedBrandNotes(db, now = Date.now()) {
  for (const note of STARTER_BRAND_NOTES) {
    await db.execute(
      `INSERT IGNORE INTO cmo_brand_notes (category, note, source, status, starterKey, createdAt, updatedAt)
       VALUES (?, ?, 'starter', 'active', ?, ?, ?)`,
      [note.category, note.note, note.key, now, now]
    );
  }
}

export async function addBrandNote(db, { category, note, source, active, userId, userName }, now = Date.now()) {
  const body = text(note, 2000);
  if (!body) throw new Error('A brand note needs text');
  const [result] = await db.execute(
    `INSERT INTO cmo_brand_notes (category, note, source, status, createdByUserId, createdByName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      NOTE_CATEGORIES.includes(category) ? category : 'fact',
      body,
      text(source, 16) || 'chat',
      active ? 'active' : 'suggested',
      userId != null ? String(userId) : null,
      text(userName, 255),
      now,
      now,
    ]
  );
  return { id: Number(result.insertId), status: active ? 'active' : 'suggested' };
}

export async function setBrandNoteStatus(db, id, status, now = Date.now()) {
  if (!['active', 'archived', 'suggested'].includes(status)) throw new Error('Invalid brand note status');
  const [result] = await db.execute('UPDATE cmo_brand_notes SET status = ?, updatedAt = ? WHERE id = ?', [
    status,
    now,
    Number(id),
  ]);
  return Number(result?.affectedRows || 0) > 0;
}

export async function listBrandNotes(db, status = 'active') {
  const where = status ? 'WHERE status = ?' : '';
  const [rows] = await db.execute(
    `SELECT id, category, note, source, status, createdByName FROM cmo_brand_notes ${where}
     ORDER BY FIELD(category, 'voice', 'language', 'dont', 'do', 'visual', 'audience', 'platform', 'campaign', 'fact'), id
     LIMIT 200`,
    status ? [status] : []
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

// ---------- assets ----------

export async function saveAsset(db, asset, now = Date.now()) {
  const [result] = await db.execute(
    `INSERT INTO cmo_assets
       (chatId, telegramFileId, telegramFileUniqueId, kind, fileName, mimeType, byteSize, data,
        title, uploadedByUserId, uploadedByName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(asset.chatId),
      String(asset.telegramFileId),
      text(asset.telegramFileUniqueId, 128),
      asset.kind,
      text(asset.fileName, 255),
      text(asset.mimeType, 128),
      asset.byteSize ?? null,
      asset.data ?? null,
      text(asset.title, 255),
      asset.uploadedByUserId != null ? String(asset.uploadedByUserId) : null,
      text(asset.uploadedByName, 255),
      now,
      now,
    ]
  );
  return Number(result.insertId);
}

export async function updateAsset(db, id, fields, now = Date.now()) {
  const tags = stringList(fields.tags);
  const menuItems = stringList(fields.menuItems, 20, 255);
  const [result] = await db.execute(
    `UPDATE cmo_assets SET
       title = COALESCE(?, title),
       assetType = COALESCE(?, assetType),
       description = COALESCE(?, description),
       tags = COALESCE(?, tags),
       language = COALESCE(?, language),
       menuItems = COALESCE(?, menuItems),
       campaign = COALESCE(?, campaign),
       updatedAt = ?
     WHERE id = ?`,
    [
      text(fields.title, 255),
      ASSET_TYPES.includes(fields.assetType) ? fields.assetType : null,
      text(fields.description, 4000),
      tags ? JSON.stringify(tags) : null,
      text(fields.language, 16),
      menuItems ? JSON.stringify(menuItems) : null,
      text(fields.campaign, 255),
      now,
      Number(id),
    ]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function setAssetStatus(db, id, status, now = Date.now()) {
  if (!['active', 'archived'].includes(status)) throw new Error('Invalid asset status');
  const [result] = await db.execute('UPDATE cmo_assets SET status = ?, updatedAt = ? WHERE id = ?', [
    status,
    now,
    Number(id),
  ]);
  return Number(result?.affectedRows || 0) > 0;
}

function assetRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    mimeType: row.mimeType || null,
    fileName: row.fileName || null,
    title: row.title || null,
    assetType: row.assetType || null,
    description: row.description || null,
    tags: parseJson(row.tags) || [],
    language: row.language || null,
    menuItems: parseJson(row.menuItems) || [],
    campaign: row.campaign || null,
    status: row.status,
    uploadedByName: row.uploadedByName || null,
    createdAt: Number(row.createdAt),
  };
}

const ASSET_COLUMNS = `id, kind, mimeType, fileName, title, assetType, description, tags, language,
  menuItems, campaign, status, uploadedByName, createdAt`;

export async function listAssets(db, { assetType, search, status = 'active', limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (assetType && ASSET_TYPES.includes(assetType)) {
    where.push('assetType = ?');
    params.push(assetType);
  }
  const term = text(search, 100);
  if (term) {
    where.push('(title LIKE ? OR description LIKE ? OR campaign LIKE ? OR CAST(tags AS CHAR) LIKE ?)');
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await db.execute(
    `SELECT ${ASSET_COLUMNS} FROM cmo_assets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY createdAt DESC, id DESC LIMIT ${safeLimit}`,
    params
  );
  return rows.map(assetRow);
}

export async function getAsset(db, id, { withData = false } = {}) {
  const [rows] = await db.execute(
    `SELECT ${ASSET_COLUMNS}, telegramFileId${withData ? ', data' : ''} FROM cmo_assets WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!rows?.[0]) return null;
  return {
    ...assetRow(rows[0]),
    telegramFileId: rows[0].telegramFileId,
    ...(withData ? { data: rows[0].data || null } : {}),
  };
}

// ---------- messages ----------

// Returns null when Telegram re-delivers an update we already stored.
export async function saveMessage(db, message, now = Date.now()) {
  const [result] = await db.execute(
    `INSERT IGNORE INTO cmo_messages
       (chatId, telegramMessageId, direction, fromUserId, fromName, messageType, text, assetId,
        replyToTelegramMessageId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(message.chatId),
      message.telegramMessageId ?? null,
      message.direction,
      message.fromUserId != null ? String(message.fromUserId) : null,
      text(message.fromName, 255),
      message.messageType || 'text',
      text(message.text),
      message.assetId ?? null,
      message.replyToTelegramMessageId ?? null,
      now,
    ]
  );
  if (Number(result?.affectedRows || 0) === 0) return null;
  return Number(result.insertId);
}

export async function getRecentMessages(db, chatId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const [rows] = await db.execute(
    `SELECT id, direction, fromName, messageType, text, assetId, createdAt
     FROM cmo_messages WHERE chatId = ?
     ORDER BY createdAt DESC, id DESC LIMIT ${safeLimit}`,
    [String(chatId)]
  );
  return rows.reverse();
}

// ---------- proposals ----------

export function normalizeProposal(input) {
  const proposalType = PROPOSAL_TYPES.includes(input?.proposalType) ? input.proposalType : 'post';
  const captionAr = text(input?.captionAr, 2200);
  const captionEn = text(input?.captionEn, 2200);
  if (!captionAr && !captionEn) throw new Error('Each proposal needs a caption in Arabic or English');
  const platform = PLATFORMS.includes(input?.platform) ? input.platform : 'instagram';
  const assetId = input?.assetId != null && Number.isInteger(Number(input.assetId)) ? Number(input.assetId) : null;
  return {
    proposalType,
    platform,
    scheduledDate: dateKey(input?.scheduledDate),
    scheduledTime: timeKey(input?.scheduledTime),
    assetId,
    title: text(input?.title, 255),
    captionAr,
    captionEn,
    hashtags: text(input?.hashtags, 1000),
    rationale: text(input?.rationale, 2000),
    visualBrief: text(input?.visualBrief, 2000),
  };
}

export async function insertProposal(db, proposal, meta = {}, now = Date.now()) {
  const [result] = await db.execute(
    `INSERT INTO cmo_proposals
       (batchId, proposalType, status, platform, scheduledDate, scheduledTime, assetId, title, captionAr,
        captionEn, hashtags, rationale, visualBrief, sourceMessageId, createdByName, createdAt, updatedAt)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meta.batchId ?? null,
      proposal.proposalType,
      proposal.platform,
      proposal.scheduledDate,
      proposal.scheduledTime,
      proposal.assetId,
      proposal.title,
      proposal.captionAr,
      proposal.captionEn,
      proposal.hashtags,
      proposal.rationale,
      proposal.visualBrief,
      meta.sourceMessageId ?? null,
      text(meta.createdByName, 255) || 'CMO',
      now,
      now,
    ]
  );
  return Number(result.insertId);
}

export async function setProposalBatch(db, ids, batchId) {
  if (!ids.length) return;
  await db.execute(
    `UPDATE cmo_proposals SET batchId = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [batchId, ...ids]
  );
}

function proposalRow(row) {
  return {
    id: Number(row.id),
    batchId: row.batchId != null ? Number(row.batchId) : null,
    proposalType: row.proposalType,
    status: row.status,
    platform: row.platform,
    scheduledDate: row.scheduledDate || null,
    scheduledTime: row.scheduledTime || null,
    assetId: row.assetId != null ? Number(row.assetId) : null,
    title: row.title || null,
    captionAr: row.captionAr || null,
    captionEn: row.captionEn || null,
    hashtags: row.hashtags || null,
    rationale: row.rationale || null,
    visualBrief: row.visualBrief || null,
    reviewedByName: row.reviewedByName || null,
    approvalTelegramMessageId:
      row.approvalTelegramMessageId != null ? Number(row.approvalTelegramMessageId) : null,
  };
}

export async function getProposal(db, id) {
  const [rows] = await db.execute('SELECT * FROM cmo_proposals WHERE id = ? LIMIT 1', [Number(id)]);
  return rows?.[0] ? proposalRow(rows[0]) : null;
}

export async function listProposals(db, { status, fromDate, toDate, batchId, limit = 30 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (batchId != null) {
    where.push('batchId = ?');
    params.push(Number(batchId));
  }
  if (dateKey(fromDate)) {
    where.push('scheduledDate >= ?');
    params.push(dateKey(fromDate));
  }
  if (dateKey(toDate)) {
    where.push('scheduledDate <= ?');
    params.push(dateKey(toDate));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const [rows] = await db.execute(
    `SELECT * FROM cmo_proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(scheduledDate, '9999-12-31'), scheduledTime, id LIMIT ${safeLimit}`,
    params
  );
  return rows.map(proposalRow);
}

export async function attachProposalMessage(db, id, telegramMessageId) {
  await db.execute('UPDATE cmo_proposals SET approvalTelegramMessageId = ? WHERE id = ?', [
    telegramMessageId,
    Number(id),
  ]);
}

// Only pending proposals can be approved or rejected; returns false if already handled.
export async function reviewProposal(db, id, { status, reviewerId, reviewerName }, now = Date.now()) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid review status');
  const [result] = await db.execute(
    `UPDATE cmo_proposals
     SET status = ?, reviewedByUserId = ?, reviewedByName = ?, reviewedAt = ?, updatedAt = ?
     WHERE id = ? AND status = 'pending'`,
    [status, String(reviewerId), text(reviewerName, 255), now, now, Number(id)]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function markProposalPublished(db, id, now = Date.now()) {
  const [result] = await db.execute(
    `UPDATE cmo_proposals SET status = 'published', updatedAt = ? WHERE id = ? AND status = 'approved'`,
    [now, Number(id)]
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function getOfficeSummary(db) {
  const [assets] = await db.execute(
    "SELECT COALESCE(assetType, 'untagged') AS assetType, COUNT(*) AS total FROM cmo_assets WHERE status = 'active' GROUP BY assetType"
  );
  const [proposals] = await db.execute('SELECT status, COUNT(*) AS total FROM cmo_proposals GROUP BY status');
  const [[notes]] = await db.execute(
    "SELECT SUM(status = 'active') AS active, SUM(status = 'suggested') AS suggested FROM cmo_brand_notes"
  );
  return {
    assets: assets.map((row) => ({ assetType: row.assetType, total: Number(row.total) })),
    proposals: Object.fromEntries(proposals.map((row) => [row.status, Number(row.total)])),
    brandNotes: { active: Number(notes?.active || 0), suggested: Number(notes?.suggested || 0) },
  };
}
