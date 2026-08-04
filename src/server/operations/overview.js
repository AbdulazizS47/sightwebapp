import { pool } from '../db.js';
import { getDateKeyInTimeZone, normalizeDateKey } from './date-utils.js';
import {
  getInventoryDataQuality,
  getInventoryRisks,
  getInventorySnapshot,
} from './inventory.js';
import { getOpenOrderSummary, getSalesSummary } from './sales.js';

export async function getOperationalOverview(
  { date, inventoryLookbackDays = 14, inventoryHorizonDays = 7 } = {},
  db = pool,
  options = {}
) {
  const timeZone = options.timeZone || 'Asia/Riyadh';
  const todayDateKey =
    normalizeDateKey(options.todayDateKey) || getDateKeyInTimeZone(options.now || new Date(), timeZone);
  const reportDate = normalizeDateKey(date) || todayDateKey;
  const [sales, inventory, inventoryRisks, openOrders, dataQuality] = await Promise.all([
    getSalesSummary(
      { fromDate: reportDate, toDate: reportDate, compareWithPrevious: true },
      db,
      { todayDateKey }
    ),
    getInventorySnapshot({ status: 'all', activeOnly: true, limit: 100 }, db),
    getInventoryRisks(
      {
        lookbackDays: inventoryLookbackDays,
        horizonDays: inventoryHorizonDays,
        includeNormal: false,
        limit: 25,
      },
      db,
      { now: options.now }
    ),
    getOpenOrderSummary(db),
    getInventoryDataQuality(db),
  ]);
  return {
    source: 'operational_overview',
    generatedAt: (options.now || new Date()).getTime(),
    timeZone,
    reportDate,
    sales,
    inventory: {
      counts: inventory.counts,
      urgentItems: inventory.items.filter((item) => item.isOutOfStock || item.isLowStock),
    },
    inventoryRisks,
    openOrders,
    dataQuality,
    actionBoundary: 'Read-only analysis. No operational changes were performed.',
  };
}
