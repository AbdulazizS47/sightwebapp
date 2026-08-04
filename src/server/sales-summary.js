import { pool } from './db.js';
import {
  displayDateKey,
  normalizeDateKey,
  shiftDateKey,
} from './operations/date-utils.js';
import { getSalesSummary } from './operations/sales.js';

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

export { displayDateKey, normalizeDateKey, shiftDateKey };

export async function loadSalesSummary(dateKey, db = pool) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) throw new Error('Invalid sales report date');

  const summary = await getSalesSummary(
    { fromDate: normalized, toDate: normalized, compareWithPrevious: false },
    db,
    { todayDateKey: normalized }
  );
  return {
    dateKey: normalized,
    orders: summary.metrics.orders,
    completed: summary.metrics.completedOrders,
    pending: summary.metrics.pendingOrders,
    revenue: summary.metrics.revenue,
    averageOrder: summary.metrics.averageOrderValue,
    discounts: summary.metrics.discounts,
    uniqueCustomers: summary.metrics.uniqueCustomers,
    payments: summary.payments,
    topItems: summary.products
      .map((product) => ({
        name: product.name,
        quantity: product.quantity,
        revenue: product.revenue,
      }))
      .slice(0, 5),
  };
}

function comparisonLine(summary, previous) {
  if (!previous || previous.revenue === 0) return null;
  const change = ((summary.revenue - previous.revenue) / previous.revenue) * 100;
  const arrow = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return `Revenue vs previous day: ${arrow} ${Math.abs(change).toFixed(1)}%`;
}

export function buildSalesSummaryMessage(summary, previous = null) {
  const topItems = summary.topItems.length
    ? summary.topItems.map((item, index) => `${index + 1}. ${item.name} — ${item.quantity} sold`)
    : ['No items sold'];
  const payments = summary.payments.length
    ? summary.payments.map(
        (payment) => `- ${payment.method}: ${money(payment.revenue)} SAR (${payment.orders} orders)`
      )
    : ['- No payments'];
  const comparison = comparisonLine(summary, previous);

  return [
    `SIGHT sales — ${displayDateKey(summary.dateKey)}`,
    '',
    `Revenue: ${money(summary.revenue)} SAR`,
    `Orders: ${summary.orders} (${summary.completed} completed, ${summary.pending} pending)`,
    `Average order: ${money(summary.averageOrder)} SAR`,
    `Customers: ${summary.uniqueCustomers}`,
    `Discounts: ${money(summary.discounts)} SAR`,
    ...(comparison ? [comparison] : []),
    '',
    'Payment methods:',
    ...payments,
    '',
    'Top items:',
    ...topItems,
  ].join('\n');
}
