import { pool } from '../db.js';
import {
  displayDateKey,
  normalizeDateRange,
  shiftDateKey,
} from './date-utils.js';

function parseItems(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function safeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function aggregateSalesRows(rows, { fromDate, toDate, days }) {
  const orders = Array.isArray(rows) ? rows : [];
  const productTotals = new Map();
  const payments = new Map();
  const daily = new Map();
  const customers = new Set();
  const discountCodes = new Map();
  let revenue = 0;
  let discounts = 0;
  let completed = 0;

  for (const order of orders) {
    const total = Number(order.total || 0);
    const discount = Number(order.discountAmount || 0);
    const dateKey = String(order.dateKey || '');
    revenue += total;
    discounts += discount;
    if (order.completedAt != null) completed += 1;

    const customerKey = order.userId || order.phoneNumber;
    if (customerKey) customers.add(String(customerKey));

    const paymentMethod =
      String(order.paymentMethod || 'unknown').trim().toLowerCase() || 'unknown';
    const payment = payments.get(paymentMethod) || { method: paymentMethod, orders: 0, revenue: 0 };
    payment.orders += 1;
    payment.revenue += total;
    payments.set(paymentMethod, payment);

    const day = daily.get(dateKey) || { dateKey, orders: 0, revenue: 0, discounts: 0 };
    day.orders += 1;
    day.revenue += total;
    day.discounts += discount;
    daily.set(dateKey, day);

    const discountCode = String(order.discountCode || '').trim();
    if (discountCode) {
      const code = discountCodes.get(discountCode) || {
        code: discountCode,
        orders: 0,
        discountAmount: 0,
        revenue: 0,
      };
      code.orders += 1;
      code.discountAmount += discount;
      code.revenue += total;
      discountCodes.set(discountCode, code);
    }

    for (const item of parseItems(order.items)) {
      const id = String(item?.id || item?.nameEn || item?.name || item?.nameAr || 'item');
      const name = String(
        item?.nameEn || item?.name || item?.nameAr || item?.id || 'Item'
      ).trim();
      const quantity = safeQuantity(item?.quantity);
      const price = Number(item?.price || 0);
      const product = productTotals.get(id) || {
        id,
        name,
        quantity: 0,
        revenue: 0,
        orderCount: 0,
      };
      product.quantity += quantity;
      product.revenue += quantity * price;
      product.orderCount += 1;
      productTotals.set(id, product);
    }
  }

  const roundedRevenue = roundMoney(revenue);
  return {
    source: 'orders',
    period: {
      fromDate,
      toDate,
      from: displayDateKey(fromDate),
      to: displayDateKey(toDate),
      days,
    },
    metrics: {
      revenue: roundedRevenue,
      orders: orders.length,
      completedOrders: completed,
      pendingOrders: orders.length - completed,
      averageOrderValue: orders.length ? roundMoney(revenue / orders.length) : 0,
      discounts: roundMoney(discounts),
      uniqueCustomers: customers.size,
    },
    payments: Array.from(payments.values())
      .map((payment) => ({ ...payment, revenue: roundMoney(payment.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    products: Array.from(productTotals.values())
      .map((product) => ({ ...product, revenue: roundMoney(product.revenue) }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue),
    dailyTrend: Array.from(daily.values())
      .map((day) => ({
        ...day,
        revenue: roundMoney(day.revenue),
        discounts: roundMoney(day.discounts),
      }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    discountCodes: Array.from(discountCodes.values())
      .map((code) => ({
        ...code,
        discountAmount: roundMoney(code.discountAmount),
        revenue: roundMoney(code.revenue),
      }))
      .sort((a, b) => b.orders - a.orders || b.discountAmount - a.discountAmount),
    limitations: [
      'Revenue is order revenue including VAT as stored by the application.',
      'Profit and margin are unavailable because cost-of-goods data is not stored.',
    ],
  };
}

async function loadSalesRows(range, db = pool) {
  const [rows] = await db.execute(
    `SELECT dateKey, userId, phoneNumber, items, total, discountCode, discountAmount,
            paymentMethod, completedAt
     FROM orders
     WHERE dateKey BETWEEN ? AND ?
     ORDER BY createdAt ASC`,
    [range.fromDate, range.toDate]
  );
  return Array.isArray(rows) ? rows : [];
}

function comparisonMetrics(current, previous) {
  const revenueChange =
    previous.metrics.revenue > 0
      ? roundMoney(
          ((current.metrics.revenue - previous.metrics.revenue) / previous.metrics.revenue) * 100
        )
      : null;
  const orderChange =
    previous.metrics.orders > 0
      ? roundMoney(
          ((current.metrics.orders - previous.metrics.orders) / previous.metrics.orders) * 100
        )
      : null;
  return {
    period: previous.period,
    metrics: previous.metrics,
    revenueChangePercent: revenueChange,
    orderChangePercent: orderChange,
  };
}

export async function getSalesSummary(
  { fromDate, toDate, compareWithPrevious = true } = {},
  db = pool,
  options = {}
) {
  const range = normalizeDateRange(
    { fromDate, toDate },
    { todayDateKey: options.todayDateKey, defaultDays: 1, maxDays: 366 }
  );
  const current = aggregateSalesRows(await loadSalesRows(range, db), range);

  if (!compareWithPrevious) return current;

  const previousTo = shiftDateKey(range.fromDate, -1);
  const previousFrom = shiftDateKey(previousTo, -(range.days - 1));
  const previousRange = { fromDate: previousFrom, toDate: previousTo, days: range.days };
  const previous = aggregateSalesRows(await loadSalesRows(previousRange, db), previousRange);
  return { ...current, comparison: comparisonMetrics(current, previous) };
}

export async function getProductPerformance(
  { fromDate, toDate, limit = 10 } = {},
  db = pool,
  options = {}
) {
  const summary = await getSalesSummary(
    { fromDate, toDate, compareWithPrevious: false },
    db,
    options
  );
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  return {
    source: summary.source,
    period: summary.period,
    topByQuantity: summary.products.slice(0, safeLimit),
    topByRevenue: [...summary.products]
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      .slice(0, safeLimit),
    productCount: summary.products.length,
    limitations: summary.limitations,
  };
}

export async function getOpenOrderSummary(db = pool) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue,
            MIN(createdAt) AS oldestCreatedAt, MAX(createdAt) AS newestCreatedAt
     FROM orders
     WHERE completedAt IS NULL`
  );
  const row = rows?.[0] || {};
  return {
    source: 'orders',
    openOrders: Number(row.orders || 0),
    openOrderRevenue: roundMoney(row.revenue),
    oldestOpenOrderAt: row.oldestCreatedAt != null ? Number(row.oldestCreatedAt) : null,
    newestOpenOrderAt: row.newestCreatedAt != null ? Number(row.newestCreatedAt) : null,
  };
}
