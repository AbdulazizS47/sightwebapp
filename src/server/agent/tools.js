import { pool } from '../db.js';
import { normalizeDateKey } from '../operations/date-utils.js';
import {
  getInventoryDataQuality,
  getInventoryMovementSummary,
  getInventoryRisks,
  getInventorySnapshot,
} from '../operations/inventory.js';
import { getOperationalOverview } from '../operations/overview.js';
import {
  getOpenOrderSummary,
  getProductPerformance,
  getSalesSummary,
} from '../operations/sales.js';

const dateProperty = {
  type: ['string', 'null'],
  description: 'Calendar date in YYYY-MM-DD format. Use null when not specified.',
};

export const OPERATIONAL_AGENT_TOOLS = [
  {
    type: 'function',
    name: 'get_sales_summary',
    description:
      'Get exact order revenue, order counts, customers, discounts, payments, products, daily trend, and an optional previous-period comparison.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fromDate: dateProperty,
        toDate: dateProperty,
        compareWithPrevious: {
          type: 'boolean',
          description: 'Whether to compare with the immediately preceding period of equal length.',
        },
      },
      required: ['fromDate', 'toDate', 'compareWithPrevious'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_product_performance',
    description:
      'Rank sold menu products by quantity and revenue for a date range. This reports sales, not profit.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        fromDate: dateProperty,
        toDate: dateProperty,
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      required: ['fromDate', 'toDate', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_inventory_snapshot',
    description:
      'Get current inventory quantities, thresholds, stock status, and menu-link counts.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'low', 'out', 'healthy'] },
        activeOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 250 },
      },
      required: ['status', 'activeOnly', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_inventory_risks',
    description:
      'Estimate inventory days remaining and stockout risk from recorded sale consumption. Also report waste, corrections, and missing menu links.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        lookbackDays: { type: 'integer', minimum: 1, maximum: 90 },
        horizonDays: { type: 'integer', minimum: 1, maximum: 60 },
        includeNormal: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['lookbackDays', 'horizonDays', 'includeNormal', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_inventory_movements',
    description:
      'Get aggregated sale, waste, correction, adjustment, and restock movements for one inventory item.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        inventoryItemId: { type: 'string', minLength: 1, maxLength: 64 },
        lookbackDays: { type: 'integer', minimum: 1, maximum: 365 },
      },
      required: ['inventoryItemId', 'lookbackDays'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_open_orders',
    description: 'Get the number, value, and age boundaries of orders that are not completed.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_data_quality_report',
    description:
      'Check whether menu items or inventory items are missing usage rules or thresholds, and whether any stock is negative.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_operational_overview',
    description:
      'Get a combined operational briefing with sales, open orders, inventory risks, low stock, and data-quality warnings.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        date: dateProperty,
        inventoryLookbackDays: { type: 'integer', minimum: 1, maximum: 90 },
        inventoryHorizonDays: { type: 'integer', minimum: 1, maximum: 60 },
      },
      required: ['date', 'inventoryLookbackDays', 'inventoryHorizonDays'],
      additionalProperties: false,
    },
  },
];

function normalizeNullableDate(value) {
  if (value == null || value === '') return undefined;
  const normalized = normalizeDateKey(value);
  if (!normalized) throw new Error('Date must use YYYY-MM-DD format');
  return normalized;
}

export async function executeOperationalTool(name, args = {}, context = {}) {
  const db = context.db || pool;
  const options = {
    todayDateKey: context.todayDateKey,
    timeZone: context.timeZone,
    now: context.now,
  };
  switch (name) {
    case 'get_sales_summary':
      return getSalesSummary(
        {
          fromDate: normalizeNullableDate(args.fromDate),
          toDate: normalizeNullableDate(args.toDate),
          compareWithPrevious: args.compareWithPrevious !== false,
        },
        db,
        options
      );
    case 'get_product_performance':
      return getProductPerformance(
        {
          fromDate: normalizeNullableDate(args.fromDate),
          toDate: normalizeNullableDate(args.toDate),
          limit: args.limit,
        },
        db,
        options
      );
    case 'get_inventory_snapshot':
      return getInventorySnapshot(
        { status: args.status, activeOnly: args.activeOnly, limit: args.limit },
        db
      );
    case 'get_inventory_risks':
      return getInventoryRisks(
        {
          lookbackDays: args.lookbackDays,
          horizonDays: args.horizonDays,
          includeNormal: args.includeNormal,
          limit: args.limit,
        },
        db,
        options
      );
    case 'get_inventory_movements':
      return getInventoryMovementSummary(
        { inventoryItemId: args.inventoryItemId, lookbackDays: args.lookbackDays },
        db,
        options
      );
    case 'get_open_orders':
      return getOpenOrderSummary(db);
    case 'get_data_quality_report':
      return getInventoryDataQuality(db);
    case 'get_operational_overview':
      return getOperationalOverview(
        {
          date: normalizeNullableDate(args.date),
          inventoryLookbackDays: args.inventoryLookbackDays,
          inventoryHorizonDays: args.inventoryHorizonDays,
        },
        db,
        options
      );
    default:
      throw new Error(`Unknown operational tool: ${name}`);
  }
}
