import { executeOperationalTool } from '../agent/tools.js';
import {
  ASSET_TYPES,
  NOTE_CATEGORIES,
  PLATFORMS,
  PROPOSAL_TYPES,
  addBrandNote,
  getAsset,
  insertProposal,
  listAssets,
  listBrandNotes,
  listProposals,
  normalizeProposal,
  setAssetStatus,
  setBrandNoteStatus,
  updateAsset,
} from './store.js';

// Claude accepts base64 images up to 5 MB.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const str = (description) => ({ type: 'string', description });
const nstr = (description) => ({ type: ['string', 'null'], description });
const date = nstr('YYYY-MM-DD, or null.');

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  };
}

export const CMO_OFFICE_TOOLS = [
  tool(
    'update_asset',
    'Catalogue a design or photo in the library after you look at it: give it a short title, a type, a description of what it shows (layout, text on it, colors, items), tags, language and menu items shown. Call this for every new upload.',
    {
      assetId: { type: 'integer' },
      title: str('Short name, e.g. "V60 night story - black".'),
      assetType: { type: 'string', enum: ASSET_TYPES },
      description: str('What the design shows and what it is good for. Include any text that appears on it.'),
      tags: { type: 'array', items: { type: 'string' }, maxItems: 15 },
      language: { type: ['string', 'null'], enum: ['ar', 'en', 'ar_en', 'none', null] },
      menuItems: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Menu items shown, by English name.' },
      campaign: nstr('Campaign or occasion it belongs to, if any.'),
    },
    ['assetId', 'title', 'assetType', 'description']
  ),
  tool(
    'list_assets',
    'Search the design library (Canva designs, photos, logos, brand book pages) by type or text.',
    {
      assetType: { type: ['string', 'null'], enum: [...ASSET_TYPES, null] },
      search: nstr('Text to find in title, description, tags or campaign.'),
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
    }
  ),
  tool(
    'view_asset',
    'Look at a stored design again (returns the image) before choosing it for a post.',
    { assetId: { type: 'integer' } },
    ['assetId']
  ),
  tool(
    'archive_asset',
    'Remove a design from the active library (owner only). It stays stored.',
    { assetId: { type: 'integer' } },
    ['assetId']
  ),
  tool(
    'add_brand_note',
    'Remember a brand rule or fact the group tells you (voice, words to avoid, visual rules, audience, platform habits, campaigns). Notes from the owner become active rules at once; notes from others are saved as suggestions for the owner.',
    {
      category: { type: 'string', enum: NOTE_CATEGORIES },
      note: str('The rule or fact, in one or two clear English sentences.'),
    },
    ['category', 'note']
  ),
  tool(
    'list_brand_notes',
    'List brand notes. status "active" are the rules you follow; "suggested" wait for the owner.',
    { status: { type: ['string', 'null'], enum: ['active', 'suggested', 'archived', null] } }
  ),
  tool(
    'set_brand_note_status',
    'Owner only: activate a suggested note, or archive a note that no longer applies.',
    { noteId: { type: 'integer' }, status: { type: 'string', enum: ['active', 'archived'] } },
    ['noteId', 'status']
  ),
  tool(
    'propose_posts',
    'Draft posts, stories, reels or campaign/broadcast ideas for owner approval. Each becomes a card with Approve/Reject buttons in the group. Nothing is published by this tool.',
    {
      proposals: {
        type: 'array',
        minItems: 1,
        maxItems: 14,
        items: {
          type: 'object',
          properties: {
            proposalType: { type: 'string', enum: PROPOSAL_TYPES },
            platform: { type: 'string', enum: PLATFORMS },
            scheduledDate: date,
            scheduledTime: nstr('HH:MM Riyadh time, or null.'),
            assetId: { type: ['integer', 'null'], description: 'Library design to use, or null if a new design is needed.' },
            title: str('Short internal title.'),
            captionAr: str('Arabic caption, ready to paste.'),
            captionEn: nstr('English caption, ready to paste.'),
            hashtags: nstr('Hashtags, space separated.'),
            rationale: str('One line: why this post, backed by data when possible.'),
            visualBrief: nstr('If no library design fits: what to make in Canva.'),
          },
          required: ['proposalType', 'platform', 'title', 'captionAr', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    ['proposals']
  ),
  tool('list_proposals', 'List drafted proposals and their status (pending, approved, rejected, published).', {
    status: { type: ['string', 'null'], enum: ['pending', 'approved', 'rejected', 'published', null] },
    fromDate: date,
    toDate: date,
  }),
  tool('get_menu', 'Current menu from the ordering app: names (EN/AR), prices in SAR incl. VAT, category, availability.', {
    availableOnly: { type: ['boolean', 'null'] },
  }),
  tool('get_store_hours', 'Current open status and opening hours from the ordering app.', {}),
  tool(
    'get_sales_summary',
    'Exact sales from the ordering app for a date range: revenue incl. VAT, orders, customers, discounts, products, daily trend, comparison with the previous period.',
    { fromDate: date, toDate: date }
  ),
  tool(
    'get_product_performance',
    'Rank menu items by quantity and revenue for a date range (sales, not profit). Use it to decide what to push.',
    { fromDate: date, toDate: date, limit: { type: ['integer', 'null'], minimum: 1, maximum: 25 } }
  ),
];

export const OWNER_ONLY_TOOLS = new Set(['archive_asset', 'set_brand_note_status']);

async function getMenu(db, availableOnly) {
  const [rows] = await db.execute(
    `SELECT i.id, i.nameEn, i.nameAr, i.price, i.available, i.descriptionEn, i.descriptionAr,
            c.nameEn AS categoryEn
     FROM items i LEFT JOIN categories c ON c.id = i.category
     ${availableOnly ? 'WHERE i.available = 1' : ''}
     ORDER BY c.\`order\`, i.nameEn LIMIT 300`
  );
  return rows.map((row) => ({
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    priceSar: Number(row.price),
    available: Boolean(Number(row.available)),
    category: row.categoryEn || null,
    descriptionEn: row.descriptionEn || null,
    descriptionAr: row.descriptionAr || null,
  }));
}

async function getStoreHours(db) {
  const keys = ['openStatus', 'scheduleEnabled', 'hoursStart', 'hoursEnd', 'hoursEn', 'hoursAr'];
  const [rows] = await db.execute(
    `SELECT \`key\`, \`value\` FROM app_settings WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const map = Object.fromEntries(rows.map((row) => [row.key, String(row.value)]));
  return {
    manualOpen: map.openStatus != null ? map.openStatus === 'true' : null,
    scheduleEnabled: map.scheduleEnabled != null ? map.scheduleEnabled === 'true' : null,
    start: map.hoursStart || process.env.DEFAULT_HOURS_START || '16:00',
    end: map.hoursEnd || process.env.DEFAULT_HOURS_END || '02:00',
    hoursEn: map.hoursEn || process.env.DEFAULT_HOURS_EN || 'Daily: 4:00 PM - 2:00 AM',
    hoursAr: map.hoursAr || process.env.DEFAULT_HOURS_AR || 'يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا',
  };
}

async function viewAsset(db, assetId) {
  const asset = await getAsset(db, assetId, { withData: true });
  if (!asset) return { error: true, message: `No asset #${assetId}` };
  const { data, ...meta } = asset;
  delete meta.telegramFileId;
  if (data && CLAUDE_IMAGE_TYPES.has(asset.mimeType) && data.length <= MAX_IMAGE_BYTES) {
    return {
      content: [
        { type: 'text', text: JSON.stringify(meta) },
        { type: 'image', source: { type: 'base64', media_type: asset.mimeType, data: Buffer.from(data).toString('base64') } },
      ],
    };
  }
  return { ...meta, note: 'This file cannot be shown as an image; use its stored description.' };
}

// Returns either a JSON-able object or { content: [...] } with ready-made content blocks.
export async function executeCmoOfficeTool(name, args, context) {
  const { db, sender, isApprover, sourceMessageId, savedProposals, timeZone, todayDateKey } = context;
  if (OWNER_ONLY_TOOLS.has(name) && !isApprover) {
    return { error: true, message: 'Only the owner can do this. Ask them in the group.' };
  }
  const opsContext = { db, timeZone, todayDateKey, now: new Date() };
  switch (name) {
    case 'update_asset':
      return { updated: await updateAsset(db, args.assetId, args) };
    case 'list_assets':
      return { assets: await listAssets(db, args) };
    case 'view_asset':
      return viewAsset(db, args.assetId);
    case 'archive_asset':
      return { archived: await setAssetStatus(db, args.assetId, 'archived') };
    case 'add_brand_note':
      return addBrandNote(db, {
        category: args.category,
        note: args.note,
        source: 'chat',
        active: isApprover,
        userId: sender?.id,
        userName: sender?.name,
      });
    case 'list_brand_notes':
      return { notes: await listBrandNotes(db, args.status === undefined ? 'active' : args.status) };
    case 'set_brand_note_status':
      return { updated: await setBrandNoteStatus(db, args.noteId, args.status) };
    case 'propose_posts': {
      const items = Array.isArray(args.proposals) ? args.proposals.slice(0, 14) : [];
      const created = [];
      for (const item of items) {
        const proposal = normalizeProposal(item);
        if (proposal.assetId != null && !(await getAsset(db, proposal.assetId))) proposal.assetId = null;
        const id = await insertProposal(db, proposal, { sourceMessageId, createdByName: 'CMO' });
        created.push({ id, title: proposal.title, scheduledDate: proposal.scheduledDate });
        savedProposals?.push(id);
      }
      return { created, note: 'Approval cards are posted to the group automatically. Do not repeat the captions in your reply.' };
    }
    case 'list_proposals':
      return { proposals: await listProposals(db, args) };
    case 'get_menu':
      return { items: await getMenu(db, args.availableOnly !== false) };
    case 'get_store_hours':
      return getStoreHours(db);
    case 'get_sales_summary':
      return executeOperationalTool(
        'get_sales_summary',
        { fromDate: args.fromDate ?? null, toDate: args.toDate ?? null, compareWithPrevious: true },
        opsContext
      );
    case 'get_product_performance':
      return executeOperationalTool(
        'get_product_performance',
        { fromDate: args.fromDate ?? null, toDate: args.toDate ?? null, limit: args.limit ?? 10 },
        opsContext
      );
    default:
      throw new Error(`Unknown CMO Office tool: ${name}`);
  }
}
