import crypto from 'node:crypto';
import { pool } from '../db.js';

export function hashExternalAgentId(channel, externalId) {
  return crypto
    .createHash('sha256')
    .update(`${String(channel || '').trim()}:${String(externalId || '').trim()}`)
    .digest('hex');
}

export async function getAgentConversation(channel, externalId, db = pool) {
  const externalIdHash = hashExternalAgentId(channel, externalId);
  const [rows] = await db.execute(
    `SELECT previousResponseId, language, createdAt, updatedAt
     FROM agent_conversations
     WHERE channel = ? AND externalIdHash = ?
     LIMIT 1`,
    [channel, externalIdHash]
  );
  const row = rows?.[0];
  return {
    externalIdHash,
    previousResponseId: row?.previousResponseId ? String(row.previousResponseId) : null,
    language: row?.language ? String(row.language) : null,
    createdAt: row?.createdAt != null ? Number(row.createdAt) : null,
    updatedAt: row?.updatedAt != null ? Number(row.updatedAt) : null,
  };
}

export async function saveAgentConversation(
  { channel, externalId, previousResponseId, language },
  db = pool
) {
  const now = Date.now();
  const externalIdHash = hashExternalAgentId(channel, externalId);
  await db.execute(
    `INSERT INTO agent_conversations
       (channel, externalIdHash, previousResponseId, language, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       previousResponseId = VALUES(previousResponseId),
       language = VALUES(language),
       updatedAt = VALUES(updatedAt)`,
    [channel, externalIdHash, previousResponseId || null, language || null, now, now]
  );
  return externalIdHash;
}

export async function clearAgentConversation(channel, externalId, db = pool) {
  const externalIdHash = hashExternalAgentId(channel, externalId);
  await db.execute(
    `DELETE FROM agent_conversations WHERE channel = ? AND externalIdHash = ?`,
    [channel, externalIdHash]
  );
}
export async function logAgentRun(
  {
    channel,
    externalId,
    requestId,
    model,
    status,
    inputChars,
    outputChars,
    toolCalls,
    usage,
    errorCode,
  },
  db = pool
) {
  const externalIdHash = hashExternalAgentId(channel, externalId);
  await db.execute(
    `INSERT INTO agent_runs
       (channel, externalIdHash, requestId, model, status, inputChars, outputChars,
        toolCalls, usageJson, errorCode, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      channel,
      externalIdHash,
      requestId || null,
      model,
      status,
      Math.max(Number(inputChars) || 0, 0),
      Math.max(Number(outputChars) || 0, 0),
      toolCalls ? JSON.stringify(toolCalls) : null,
      usage ? JSON.stringify(usage) : null,
      errorCode || null,
      Date.now(),
    ]
  );
}
