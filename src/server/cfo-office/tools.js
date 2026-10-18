import { executeOperationalTool } from '../agent/tools.js';
import {
  FREQUENCIES,
  RECORD_TYPES,
  addQuestion,
  insertRecord,
  listMembers,
  listQuestions,
  normalizeRecord,
  queryRecords,
  setMemberRole,
  updateQuestion,
} from './store.js';

const nullableString = (description) => ({ type: ['string', 'null'], description });
const nullableNumber = (description) => ({ type: ['number', 'null'], description });

function fn(name, description, properties, required = Object.keys(properties)) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  };
}

export const CFO_OFFICE_TOOLS = [
  fn(
    'save_records',
    'Store financial facts the group told you or that you read from a receipt/document. One record per distinct item (e.g. each ingredient price, each expense, each staff member). Records from non-approvers are saved as pending and the owner gets Approve/Reject buttons automatically.',
    {
      records: {
        type: 'array',
        minItems: 1,
        maxItems: 25,
        items: {
          type: 'object',
          properties: {
            recordType: { type: 'string', enum: RECORD_TYPES },
            description: { type: 'string', description: 'Short, clear English description.' },
            recordDate: nullableString('YYYY-MM-DD the money moved or the fact applies; null for today.'),
            category: nullableString('e.g. beans, milk, cups, fuel, rent, salary, permits, marketing.'),
            counterparty: nullableString('Supplier, employee, landlord, bank or provider name.'),
            amount: nullableNumber('Total amount in SAR including VAT when known.'),
            vatAmount: nullableNumber('VAT portion of amount, if shown.'),
            quantity: nullableNumber('Quantity bought or counted.'),
            unit: nullableString('kg, L, pcs, box, hour, month, etc.'),
            unitCost: nullableNumber('Cost per unit in SAR.'),
            frequency: { type: ['string', 'null'], enum: [...FREQUENCIES, null] },
            paymentMethod: nullableString('cash, card, transfer, credit, etc.'),
            inventoryItemId: nullableString('Matching inventory item id from list_inventory_items, if any.'),
            staffMemberName: nullableString('For staff/salary records.'),
            questionKey: nullableString('The CFO question this answers, if any.'),
            notes: nullableString('Anything else worth keeping.'),
          },
          required: ['recordType', 'description'],
          additionalProperties: false,
        },
      },
    }
  ),
  fn(
    'update_question',
    'Mark a CFO question answered (with a one-line summary), skipped (not applicable), or open again (answer incomplete).',
    {
      questionKey: { type: 'string' },
      status: { type: 'string', enum: ['open', 'answered', 'skipped'] },
      answerSummary: nullableString('One-line summary of the answer.'),
    }
  ),
  fn(
    'add_question',
    'Add a follow-up question to ask the group later when information is missing or unclear.',
    {
      topic: { type: 'string' },
      audience: { type: 'string', enum: ['owner', 'staff', 'any'] },
      priority: { type: 'integer', minimum: 1, maximum: 200, description: 'Lower is asked sooner.' },
      questionEn: { type: 'string' },
      questionAr: { type: 'string' },
    }
  ),
  fn('list_questions', 'List CFO questions and their status.', {
    status: { type: ['string', 'null'], enum: ['open', 'answered', 'skipped', null] },
  }),
  fn(
    'get_cfo_records',
    'Read stored CFO records with totals. Use before answering money questions or to avoid duplicates.',
    {
      recordType: { type: ['string', 'null'], enum: [...RECORD_TYPES, null] },
      status: { type: ['string', 'null'], enum: ['pending', 'confirmed', 'rejected', null] },
      fromDate: nullableString('YYYY-MM-DD'),
      toDate: nullableString('YYYY-MM-DD'),
      search: nullableString('Text to search in description, counterparty or category.'),
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 200 },
    }
  ),
  fn('list_group_members', 'List people in the CFO Office group with their roles.', {}),
  fn('set_member_role', 'Remember a group member\'s job (owner, barista, cashier, accountant, manager...).', {
    telegramUserId: { type: 'string' },
    role: { type: 'string' },
    notes: nullableString('Anything useful, e.g. "handles supplier orders".'),
  }),
  fn('get_sales_summary', 'Exact sales from the ordering system for a date range (revenue incl. VAT, orders, discounts, payment methods, products).', {
    fromDate: nullableString('YYYY-MM-DD'),
    toDate: nullableString('YYYY-MM-DD'),
  }),
  fn('list_inventory_items', 'List inventory items (ingredients and packaging) tracked by the app, with ids and units.', {}),
];

export async function executeCfoOfficeTool(name, args, context) {
  const { db, sender, isApprover, sourceMessageId, attachmentId, todayDateKey, todayIso, savedRecords } = context;
  switch (name) {
    case 'save_records': {
      const items = Array.isArray(args.records) ? args.records.slice(0, 25) : [];
      const saved = [];
      for (const item of items) {
        const record = normalizeRecord(
          { ...item, details: item.notes ? { notes: String(item.notes) } : null },
          { recordDate: todayIso }
        );
        const result = await insertRecord(db, record, {
          autoConfirm: isApprover,
          sourceMessageId,
          attachmentId,
          submittedByUserId: sender?.id,
          submittedByName: sender?.name,
        });
        saved.push({ id: result.id, status: result.status, recordType: record.recordType, description: record.description });
        savedRecords?.push({ ...record, ...result });
      }
      return {
        saved,
        note: isApprover
          ? 'Saved as confirmed because the sender is an approver.'
          : 'Saved as pending; the owner will get Approve/Reject buttons automatically.',
      };
    }
    case 'update_question':
      return { updated: await updateQuestion(db, args) };
    case 'add_question':
      return { questionKey: await addQuestion(db, args) };
    case 'list_questions':
      return { questions: await listQuestions(db, args.status) };
    case 'get_cfo_records':
      return queryRecords(db, args);
    case 'list_group_members':
      return { members: await listMembers(db) };
    case 'set_member_role':
      return { updated: await setMemberRole(db, args) };
    case 'get_sales_summary':
      return executeOperationalTool(
        'get_sales_summary',
        { fromDate: args.fromDate ?? null, toDate: args.toDate ?? null, compareWithPrevious: false },
        { db, timeZone: context.timeZone, todayDateKey, now: new Date() }
      );
    case 'list_inventory_items':
      return executeOperationalTool(
        'get_inventory_snapshot',
        { status: 'all', activeOnly: true, limit: 250 },
        { db, timeZone: context.timeZone, todayDateKey, now: new Date() }
      );
    default:
      throw new Error(`Unknown CFO Office tool: ${name}`);
  }
}
