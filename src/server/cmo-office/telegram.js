import { getDateKeyInTimeZone } from '../operations/date-utils.js';
import { createCmoOfficeAgent } from './agent.js';
import { getCmoOfficeConfig } from './config.js';
import {
  attachProposalMessage,
  getAsset,
  getOfficeSummary,
  getProposal,
  listAssets,
  listBrandNotes,
  listProposals,
  markProposalPublished,
  reviewProposal,
  saveAsset,
  saveMessage,
  seedBrandNotes,
  setProposalBatch,
} from './store.js';
import { CLAUDE_IMAGE_TYPES, MAX_IMAGE_BYTES } from './tools.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const TEXT_MIME = /^(text\/|application\/(json|markdown))/;
const PLATFORM_LABELS = {
  instagram: 'Instagram',
  snapchat: 'Snapchat',
  tiktok: 'TikTok',
  x: 'X',
  whatsapp: 'WhatsApp',
  google_maps: 'Google Maps',
  in_truck: 'In the truck',
  other: 'Other',
};
const TYPE_LABELS = {
  post: 'post',
  story: 'story',
  reel: 'reel',
  broadcast_idea: 'broadcast idea',
  campaign_idea: 'campaign idea',
};

function senderOf(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return {
    id: from?.id != null ? String(from.id) : null,
    name: name || from?.username || 'Unknown',
    username: from?.username || null,
  };
}

function commandOf(text) {
  const first = String(text || '').trim().split(/\s+/)[0] || '';
  if (!first.startsWith('/')) return null;
  return first.toLowerCase().split('@')[0];
}

function clip(value, max) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const STATUS_LINES = {
  pending: null,
  approved: (p) => `✅ Approved${p.reviewedByName ? ` by ${p.reviewedByName}` : ''}. Ready to post. / جاهز للنشر`,
  rejected: () => '❌ Rejected. Reply to this card with what to change and I will redraft. / رد على البطاقة بالتعديل',
  published: () => '📤 Posted. / تم النشر',
};

export function formatProposalCard(proposal, asset) {
  const when = [proposal.scheduledDate, proposal.scheduledTime].filter(Boolean).join(' ');
  const head = `📝 Draft #${proposal.id} · ${PLATFORM_LABELS[proposal.platform] || proposal.platform} ${
    TYPE_LABELS[proposal.proposalType] || proposal.proposalType
  }${when ? ` · ${when}` : ''}`;
  const design = asset
    ? `🎨 Design: #${asset.id} ${asset.title || ''}`.trim()
    : proposal.visualBrief
      ? `🎨 Needs a design: ${proposal.visualBrief}`
      : null;
  const status = STATUS_LINES[proposal.status]?.(proposal);
  const parts = [
    status,
    head,
    proposal.title,
    '',
    proposal.captionAr,
    proposal.captionEn ? `\n${proposal.captionEn}` : null,
    proposal.hashtags ? `\n${proposal.hashtags}` : null,
    '',
    proposal.rationale ? `💡 ${proposal.rationale}` : null,
    design,
  ].filter((part) => part !== null && part !== undefined);
  return clip(parts.join('\n'), 4000);
}

function cardKeyboard(proposal) {
  if (proposal.status === 'pending') {
    return {
      inline_keyboard: [
        [
          { text: `✅ Approve #${proposal.id}`, callback_data: `cmo:a:${proposal.id}` },
          { text: `❌ Reject #${proposal.id}`, callback_data: `cmo:r:${proposal.id}` },
        ],
      ],
    };
  }
  if (proposal.status === 'approved') {
    return { inline_keyboard: [[{ text: '📤 Mark as posted', callback_data: `cmo:p:${proposal.id}` }]] };
  }
  return { inline_keyboard: [] };
}

function helpText() {
  return [
    'CMO Office / مكتب التسويق',
    '',
    'Send me your Canva designs (PNG/JPG, or PDF for multi-page), photos, logos or the brand book, with a caption saying what each is for. I catalogue them and use them in posts.',
    'أرسل تصاميم كانفا والصور ودليل الهوية مع وصف قصير، وسأرتبها وأستخدمها في المنشورات.',
    '',
    'Tell me brand rules any time ("never say cheap") and I will follow them.',
    '',
    '/cmo_today — draft today’s post',
    '/cmo_week — draft the next 7 days',
    '/cmo_pending — drafts waiting for approval',
    '/cmo_library — designs I have',
    '/cmo_brand — brand rules I follow',
    '/cmo_summary — overview',
    '/cmo_setup — show this chat id and your user id',
  ].join('\n');
}

const TODAY_TASK = (iso) =>
  `Scheduled task: draft today's (${iso}) "open tonight" post or story. Check get_store_hours and get_product_performance for the last 7 days, pick one item or theme worth pushing, choose a library design if one fits, and call propose_posts once. Reply with one short line.`;
const WEEK_TASK = (iso) =>
  `Scheduled task: plan the next 7 days starting ${iso}. Check get_product_performance and get_sales_summary for the last 14 days, the menu, store hours, and the design library. Propose a 7-day calendar with propose_posts (one item per day, mixed formats, at most one broadcast idea). Reply with a 3-4 line summary of the plan and why.`;

async function withLock(db, name, fn) {
  if (typeof db.getConnection !== 'function') return fn(db);
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    locked = Number(rows?.[0]?.acquired || 0) === 1;
    if (!locked) return null;
    return await fn(connection);
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    connection.release();
  }
}

// Sets an app_settings slot to `value`; returns true only the first time.
async function claimSlot(conn, key, value) {
  const [rows] = await conn.execute('SELECT `value` FROM app_settings WHERE `key` = ? LIMIT 1', [key]);
  if (String(rows?.[0]?.value || '') === value) return false;
  await conn.execute(
    `INSERT INTO app_settings (\`key\`, \`value\`, updatedAt) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updatedAt = VALUES(updatedAt)`,
    [key, value, Date.now()]
  );
  return true;
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export function createCmoOffice({
  db,
  telegram,
  agent,
  config = getCmoOfficeConfig(),
  timeZone = 'Asia/Riyadh',
  now = () => new Date(),
}) {
  const effectiveAgent = agent || (config.ready ? createCmoOfficeAgent({ db, timeZone, now }) : null);
  let botIdentity = null;

  async function getBot() {
    if (!botIdentity) botIdentity = await telegram.call('getMe', {}).catch(() => null);
    return botIdentity;
  }

  async function record(result, text, assetId = null) {
    const bot = await getBot();
    await saveMessage(db, {
      chatId: config.chatId,
      telegramMessageId: result?.message_id ?? null,
      direction: 'out',
      fromUserId: bot?.id ?? null,
      fromName: 'CMO',
      messageType: 'text',
      text,
      assetId,
    }).catch((error) => console.error('Failed to store CMO Office outbound message', error));
  }

  async function send(text, { replyTo, keyboard } = {}) {
    const result = await telegram.call('sendMessage', {
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
    await record(result, text);
    return result;
  }

  async function sendAsset(asset, caption) {
    const isImage = asset.kind === 'photo' || CLAUDE_IMAGE_TYPES.has(asset.mimeType);
    return telegram
      .call(isImage && asset.kind === 'photo' ? 'sendPhoto' : 'sendDocument', {
        chat_id: config.chatId,
        [isImage && asset.kind === 'photo' ? 'photo' : 'document']: asset.telegramFileId,
        caption: clip(caption, 1000),
      })
      .catch((error) => console.error('Failed to send CMO asset', error));
  }

  async function postCards(proposalIds) {
    if (!proposalIds.length) return 0;
    const proposals = [];
    for (const id of proposalIds) {
      const proposal = await getProposal(db, id);
      if (proposal?.status !== 'pending') continue;
      const asset = proposal.assetId ? await getAsset(db, proposal.assetId) : null;
      if (asset) await sendAsset(asset, `Design for draft #${proposal.id}`);
      const card = formatProposalCard(proposal, asset);
      const result = await send(card, { keyboard: cardKeyboard(proposal) });
      if (result?.message_id != null) await attachProposalMessage(db, proposal.id, result.message_id);
      proposals.push(proposal);
    }
    if (proposals.length > 1) {
      const batchId = proposals[0].id;
      await setProposalBatch(db, proposals.map((p) => p.id), batchId);
      await send(`${proposals.length} drafts above / ${proposals.length} مسودات`, {
        keyboard: { inline_keyboard: [[{ text: `✅ Approve all ${proposals.length}`, callback_data: `cmo:ab:${batchId}` }]] },
      });
    }
    return proposals.length;
  }

  async function refreshCard(id) {
    const proposal = await getProposal(db, id);
    if (!proposal?.approvalTelegramMessageId) return;
    const asset = proposal.assetId ? await getAsset(db, proposal.assetId) : null;
    await telegram
      .call('editMessageText', {
        chat_id: config.chatId,
        message_id: proposal.approvalTelegramMessageId,
        text: formatProposalCard(proposal, asset),
        disable_web_page_preview: true,
        reply_markup: cardKeyboard(proposal),
      })
      .catch((error) => console.error('Failed to update CMO proposal card', error));
  }

  async function runAgent({ text, sender, isApprover, file, attachmentNote, sourceMessageId, replyTo, requestId }) {
    if (!effectiveAgent) {
      if (replyTo) await send('The CMO is not configured yet (ANTHROPIC_API_KEY missing).', { replyTo });
      return { skipped: true, reason: 'agent_not_configured' };
    }
    await telegram.call('sendChatAction', { chat_id: config.chatId, action: 'typing' }).catch(() => {});
    const result = await effectiveAgent.handle({
      chatId: config.chatId,
      sender,
      isApprover,
      text,
      file,
      attachmentNote,
      sourceMessageId,
      requestId,
    });
    if (result.text) await send(result.text, { replyTo });
    const cards = await postCards(result.savedProposals || []);
    return { replied: Boolean(result.text), proposals: cards };
  }

  async function storeUpload(message, sender, caption) {
    let file = null;
    let kind = null;
    if (Array.isArray(message.photo) && message.photo.length) {
      file = { ...message.photo[message.photo.length - 1], mime_type: 'image/jpeg' };
      kind = 'photo';
    } else if (message.document) {
      file = message.document;
      kind = 'document';
    } else if (message.video || message.animation || message.voice || message.audio || message.video_note) {
      return { note: `${sender.name} sent a video or audio message. You cannot watch or hear it yet; ask for a screenshot or a short description.` };
    }
    if (!file?.file_id) return null;

    let data = null;
    let problem = null;
    if (Number(file.file_size || 0) <= config.maxAttachmentBytes) {
      try {
        ({ data } = await telegram.download(file.file_id, config.maxAttachmentBytes));
      } catch (error) {
        console.error('CMO Office could not download a Telegram file', error);
        problem = 'the file could not be downloaded';
      }
    } else {
      problem = 'the file is larger than 20 MB, which Telegram bots cannot download; ask for a smaller export';
    }
    const fileName = file.file_name || null;
    let mimeType = file.mime_type || null;
    if (!mimeType && fileName?.toLowerCase().endsWith('.md')) mimeType = 'text/markdown';
    const assetId = await saveAsset(db, {
      chatId: config.chatId,
      telegramFileId: file.file_id,
      telegramFileUniqueId: file.file_unique_id,
      kind,
      fileName,
      mimeType,
      byteSize: data ? data.length : file.file_size ?? null,
      data,
      title: caption ? clip(caption, 255) : fileName,
      uploadedByUserId: sender.id,
      uploadedByName: sender.name,
    });

    if (problem) return { assetId, kind, note: `${sender.name} sent a ${kind}, but ${problem}.` };
    if (CLAUDE_IMAGE_TYPES.has(mimeType)) {
      if (data.length <= MAX_IMAGE_BYTES) {
        return { assetId, kind, file: { kind: 'image', mimeType, base64: data.toString('base64'), assetId } };
      }
      return {
        assetId,
        kind,
        note: `The image is over 5 MB, so you cannot see it. It is stored as asset #${assetId}; ask them to also send it as a compressed photo so you can catalogue it.`,
      };
    }
    if (mimeType === 'application/pdf' && data.length <= MAX_PDF_BYTES) {
      return { assetId, kind, file: { kind: 'pdf', base64: data.toString('base64'), assetId } };
    }
    if (mimeType && TEXT_MIME.test(mimeType)) {
      return { assetId, kind, file: { kind: 'text', text: data.toString('utf8').slice(0, MAX_TEXT_CHARS), assetId } };
    }
    return {
      assetId,
      kind,
      note: `${sender.name} sent "${fileName || 'a file'}" (${mimeType || 'unknown type'}), stored as asset #${assetId}. You cannot open this type; ask for PNG/JPG or PDF.`,
    };
  }

  async function handleCommand(command, message, sender, isApprover, sourceMessageId) {
    const replyTo = message.message_id;
    const todayIso = (() => {
      const key = getDateKeyInTimeZone(now(), timeZone);
      return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    })();
    switch (command) {
      case '/cmo_help':
      case '/help':
      case '/start':
        await send(helpText(), { replyTo });
        return true;
      case '/cmo_setup':
        await send(`Chat id: ${message.chat.id}\nYour user id: ${sender.id}`, { replyTo });
        return true;
      case '/cmo_library': {
        const assets = await listAssets(db, { limit: 40 });
        await send(
          assets.length
            ? [`Design library (${assets.length}) / مكتبة التصاميم`, ...assets.map((a) => `• #${a.id} ${a.assetType || 'untagged'}: ${a.title || a.fileName || 'untitled'}`)].join('\n')
            : 'No designs yet. Send me your Canva exports. / لا توجد تصاميم بعد.',
          { replyTo }
        );
        return true;
      }
      case '/cmo_brand': {
        const [active, suggested] = await Promise.all([listBrandNotes(db, 'active'), listBrandNotes(db, 'suggested')]);
        const lines = ['Brand rules I follow / قواعد الهوية', ...active.map((n) => `• #${n.id} [${n.category}] ${n.note}`)];
        if (suggested.length) {
          lines.push('', 'Suggested, waiting for the owner:', ...suggested.map((n) => `• #${n.id} [${n.category}] ${n.note} (${n.createdByName || '?'})`));
        }
        await send(clip(lines.join('\n'), 4000), { replyTo });
        return true;
      }
      case '/cmo_pending': {
        const pending = await listProposals(db, { status: 'pending', limit: 20 });
        if (!pending.length) await send('Nothing is waiting for approval.', { replyTo });
        else await postCards(pending.map((p) => p.id));
        return true;
      }
      case '/cmo_summary': {
        const summary = await getOfficeSummary(db);
        await send(
          [
            'CMO Office summary / ملخص',
            `Designs: ${summary.assets.reduce((n, a) => n + a.total, 0)} (${summary.assets.map((a) => `${a.assetType} ${a.total}`).join(', ') || 'none'})`,
            `Brand rules: ${summary.brandNotes.active} active, ${summary.brandNotes.suggested} suggested`,
            `Drafts: ${Object.entries(summary.proposals).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`,
          ].join('\n'),
          { replyTo }
        );
        return true;
      }
      case '/cmo_today':
      case '/cmo_week':
        await runAgent({
          text: (command === '/cmo_today' ? TODAY_TASK : WEEK_TASK)(todayIso).replace('Scheduled task', 'Request'),
          sender,
          isApprover,
          sourceMessageId,
          replyTo,
        });
        return true;
      default:
        return false;
    }
  }

  async function processMessage(message, update) {
    const sender = senderOf(message.from);
    const isApprover = Boolean(sender.id && config.approverUserIds.includes(sender.id));
    const text = String(message.text ?? message.caption ?? '').trim();
    const upload = await storeUpload(message, sender, message.caption);
    const repliedCard = message.reply_to_message?.message_id
      ? (await listProposals(db, { limit: 100 })).find(
          (p) => p.approvalTelegramMessageId === Number(message.reply_to_message.message_id)
        )
      : null;
    const sourceMessageId = await saveMessage(db, {
      chatId: config.chatId,
      telegramMessageId: message.message_id,
      direction: 'in',
      fromUserId: sender.id,
      fromName: sender.name,
      messageType: upload?.kind || 'text',
      text: text || (upload?.kind ? `[${upload.kind}]` : null),
      assetId: upload?.assetId ?? null,
      replyToTelegramMessageId: message.reply_to_message?.message_id ?? null,
    });
    if (sourceMessageId == null) return { duplicate: true };

    const command = commandOf(text);
    if (command && (await handleCommand(command, message, sender, isApprover, sourceMessageId))) return { command };

    if (config.replyMode === 'mentions' && !upload && !repliedCard) {
      const bot = await getBot();
      const mentioned = bot?.username && text.toLowerCase().includes(`@${bot.username.toLowerCase()}`);
      const repliedToBot = bot?.id != null && message.reply_to_message?.from?.id === bot.id;
      if (!mentioned && !repliedToBot) return { skipped: true };
    }
    if (!text && !upload) return { skipped: true };

    const notes = [upload?.note];
    if (repliedCard) {
      notes.push(
        `This message replies to draft #${repliedCard.id} (status ${repliedCard.status}). If it asks for changes, propose a revised version with propose_posts.`
      );
    }
    return runAgent({
      text,
      sender,
      isApprover,
      file: upload?.file || null,
      attachmentNote: notes.filter(Boolean).join(' ') || null,
      sourceMessageId,
      replyTo: message.message_id,
      requestId: update?.update_id != null ? String(update.update_id) : null,
    });
  }

  async function handleCallback(query) {
    const [, action, rawId] = String(query.data || '').split(':');
    const reviewer = senderOf(query.from);
    const id = /^\d+$/.test(rawId || '') ? Number(rawId) : null;
    const answer = (text, alert = false) =>
      telegram.call('answerCallbackQuery', { callback_query_id: query.id, text, ...(alert ? { show_alert: true } : {}) });
    if (id == null) return answer('Unknown action');

    if (action === 'p') {
      // Anyone in the group may mark an approved post as published (staff do the posting).
      const done = await markProposalPublished(db, id);
      await answer(done ? 'Marked as posted' : 'Already handled');
      if (done) await refreshCard(id);
      return { published: done };
    }

    if (!reviewer.id || !config.approverUserIds.includes(reviewer.id)) {
      await answer('Only the owner can approve. / الموافقة للمالك فقط.', true);
      return { denied: true };
    }
    let ids = [];
    if (action === 'ab') ids = (await listProposals(db, { batchId: id, status: 'pending', limit: 100 })).map((p) => p.id);
    else if (action === 'a' || action === 'r') ids = [id];
    const status = action === 'r' ? 'rejected' : 'approved';
    let changed = 0;
    for (const proposalId of ids) {
      if (await reviewProposal(db, proposalId, { status, reviewerId: reviewer.id, reviewerName: reviewer.name })) {
        changed += 1;
        await refreshCard(proposalId);
      }
    }
    await answer(changed ? `${status === 'approved' ? 'Approved' : 'Rejected'} ${changed}` : 'Already handled');
    if (action === 'ab' && query.message?.message_id != null) {
      await telegram
        .call('editMessageText', {
          chat_id: config.chatId,
          message_id: query.message.message_id,
          text: `✅ ${changed} drafts approved by ${reviewer.name}.`,
          reply_markup: { inline_keyboard: [] },
        })
        .catch(() => {});
    }
    return { changed };
  }

  // Returns { handled } quickly; slow work (Claude, downloads) runs in `work`.
  function handleUpdate(update) {
    if (!config.enabled) return { handled: false };
    const query = update?.callback_query;
    if (query && String(query.data || '').startsWith('cmo:')) {
      if (String(query.message?.chat?.id) !== config.chatId) return { handled: true };
      return { handled: true, work: handleCallback(query) };
    }
    const message = update?.message;
    if (!message?.chat) return { handled: false };
    const chatId = String(message.chat.id);
    if (chatId !== config.chatId) {
      if (commandOf(message.text) === '/cmo_setup') {
        const sender = senderOf(message.from);
        return {
          handled: true,
          work: telegram.call('sendMessage', {
            chat_id: chatId,
            text: `Chat id: ${chatId}\nYour user id: ${sender.id}\n\nPut the chat id in CMO_OFFICE_CHAT_ID and approver user ids in CMO_OFFICE_APPROVER_USER_IDS.`,
          }),
        };
      }
      return { handled: false };
    }
    if (message.migrate_to_chat_id) {
      console.warn(`[cmo-office] The CMO Office group became a supergroup. Update CMO_OFFICE_CHAT_ID to ${message.migrate_to_chat_id}.`);
      return { handled: true };
    }
    if (message.from?.is_bot) return { handled: true };
    return {
      handled: true,
      work: processMessage(message, update).catch(async (error) => {
        await telegram
          .call('sendMessage', {
            chat_id: config.chatId,
            text: 'I could not process that message. Please try again. / لم أستطع معالجة الرسالة، حاول مرة أخرى.',
            reply_to_message_id: message.message_id,
            allow_sending_without_reply: true,
          })
          .catch(() => {});
        throw error;
      }),
    };
  }

  // Daily post draft and weekly calendar, each at most once per slot.
  async function runSchedule(date = now()) {
    if (!config.ready || !effectiveAgent) return [];
    const { weekday, minutes } = localParts(date, timeZone);
    const key = getDateKeyInTimeZone(date, timeZone);
    const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    const due = [];
    if (config.dailyDraftTime && minutes >= toMinutes(config.dailyDraftTime)) due.push('daily');
    if (config.weeklyTime && weekday === config.weeklyDay && minutes >= toMinutes(config.weeklyTime)) due.push('weekly');
    if (!due.length) return [];
    const ran = await withLock(db, 'sight:cmo-office:schedule', async (conn) => {
      const claimed = [];
      for (const slot of due) {
        if (await claimSlot(conn, `cmoOfficeSlot:${slot}`, key)) claimed.push(slot);
      }
      return claimed;
    });
    for (const slot of ran || []) {
      await runAgent({
        text: (slot === 'daily' ? TODAY_TASK : WEEK_TASK)(iso),
        sender: { id: null, name: 'Schedule', username: null },
        isApprover: false,
      }).catch((error) => console.error(`CMO Office ${slot} run failed`, error));
    }
    return ran || [];
  }

  async function init() {
    await seedBrandNotes(db);
  }

  return { handleUpdate, runSchedule, init, postCards };
}
