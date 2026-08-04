import { pool } from '../db.js';

function roundQty(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function asBoolean(value) {
  return Boolean(Number(value));
}

export function deriveInventoryRisk(row, { lookbackDays, horizonDays, now = new Date() }) {
  const stockQty = Number(row.stockQty || 0);
  const threshold = Number(row.lowStockThreshold || 0);
  const saleUsage = Number(row.saleUsage || 0);
  const averageDailyUsage = saleUsage > 0 ? saleUsage / lookbackDays : 0;
  const daysRemaining = averageDailyUsage > 0 ? Math.max(stockQty, 0) / averageDailyUsage : null;
  const stockoutAt =
    daysRemaining != null
      ? new Date(now.getTime() + daysRemaining * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const isOutOfStock = stockQty <= 0;
  const isLowStock = threshold > 0 && stockQty <= threshold;
  const projectedWithinHorizon = daysRemaining != null && daysRemaining <= horizonDays;
  const severity = isOutOfStock
    ? 'critical'
    : projectedWithinHorizon
      ? 'high'
      : isLowStock
        ? 'medium'
        : 'normal';

  return {
    id: String(row.id),
    nameEn: String(row.nameEn || ''),
    nameAr: String(row.nameAr || ''),
    type: String(row.type || ''),
    unit: String(row.unit || ''),
    stockQty: roundQty(stockQty),
    lowStockThreshold: roundQty(threshold),
    isOutOfStock,
    isLowStock,
    saleUsage: roundQty(saleUsage),
    averageDailyUsage: roundQty(averageDailyUsage),
    estimatedDaysRemaining: daysRemaining != null ? roundQty(daysRemaining) : null,
    estimatedStockoutAt: stockoutAt,
    wasteQty: roundQty(row.wasteQty),
    correctionQty: roundQty(row.correctionQty),
    restockQty: roundQty(row.restockQty),
    linkedMenuItems: Number(row.linkedMenuItems || 0),
    severity,
    estimateBasis:
      averageDailyUsage > 0
        ? `${lookbackDays}-day recorded sale consumption`
        : 'No recorded sale consumption in the lookback period',
  };
}

export async function getInventorySnapshot(
  { status = 'all', activeOnly = true, limit = 100 } = {},
  db = pool
) {
  const normalizedStatus = ['all', 'low', 'out', 'healthy'].includes(status) ? status : 'all';
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const [rows] = await db.execute(
    `SELECT inv.id, inv.nameEn, inv.nameAr, inv.type, inv.unit, inv.stockQty,
            inv.lowStockThreshold, inv.active, inv.notes, inv.updatedAt,
            COUNT(DISTINCT r.menuItemId) AS linkedMenuItems
     FROM inventory_items inv
     LEFT JOIN inventory_usage_rules r ON r.inventoryItemId = inv.id
     ${activeOnly ? 'WHERE inv.active = 1' : ''}
     GROUP BY inv.id, inv.nameEn, inv.nameAr, inv.type, inv.unit, inv.stockQty,
              inv.lowStockThreshold, inv.active, inv.notes, inv.updatedAt
     ORDER BY inv.stockQty <= 0 DESC,
              (inv.lowStockThreshold > 0 AND inv.stockQty <= inv.lowStockThreshold) DESC,
              inv.type ASC, inv.nameEn ASC
     LIMIT ${safeLimit}`
  );

  const items = (Array.isArray(rows) ? rows : []).map((row) => {
    const stockQty = Number(row.stockQty || 0);
    const threshold = Number(row.lowStockThreshold || 0);
    return {
      id: String(row.id),
      nameEn: String(row.nameEn || ''),
      nameAr: String(row.nameAr || ''),
      type: String(row.type || ''),
      unit: String(row.unit || ''),
      stockQty: roundQty(stockQty),
      lowStockThreshold: roundQty(threshold),
      active: asBoolean(row.active),
      isOutOfStock: stockQty <= 0,
      isLowStock: threshold > 0 && stockQty <= threshold,
      linkedMenuItems: Number(row.linkedMenuItems || 0),
      updatedAt: row.updatedAt != null ? Number(row.updatedAt) : null,
    };
  });

  const filtered = items.filter((item) => {
    if (normalizedStatus === 'low') return item.isLowStock;
    if (normalizedStatus === 'out') return item.isOutOfStock;
    if (normalizedStatus === 'healthy') return !item.isOutOfStock && !item.isLowStock;
    return true;
  });
  return {
    source: 'inventory_items',
    generatedAt: Date.now(),
    filters: { status: normalizedStatus, activeOnly: Boolean(activeOnly) },
    counts: {
      returned: filtered.length,
      totalLoaded: items.length,
      outOfStock: items.filter((item) => item.isOutOfStock).length,
      lowStock: items.filter((item) => item.isLowStock).length,
      withoutMenuLinks: items.filter((item) => item.linkedMenuItems === 0).length,
    },
    items: filtered,
  };
}

export async function getInventoryRisks(
  { lookbackDays = 14, horizonDays = 7, includeNormal = false, limit = 50 } = {},
  db = pool,
  options = {}
) {
  const safeLookback = Math.min(Math.max(Number(lookbackDays) || 14, 1), 90);
  const safeHorizon = Math.min(Math.max(Number(horizonDays) || 7, 1), 60);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const now = options.now instanceof Date ? options.now : new Date();
  const since = now.getTime() - safeLookback * 24 * 60 * 60 * 1000;
  const [rows] = await db.execute(
    `SELECT inv.id, inv.nameEn, inv.nameAr, inv.type, inv.unit, inv.stockQty,
            inv.lowStockThreshold, inv.active,
            COALESCE(links.linkedMenuItems, 0) AS linkedMenuItems,
            COALESCE(movements.saleUsage, 0) AS saleUsage,
            COALESCE(movements.wasteQty, 0) AS wasteQty,
            COALESCE(movements.correctionQty, 0) AS correctionQty,
            COALESCE(movements.restockQty, 0) AS restockQty
     FROM inventory_items inv
     LEFT JOIN (
       SELECT inventoryItemId, COUNT(DISTINCT menuItemId) AS linkedMenuItems
       FROM inventory_usage_rules
       GROUP BY inventoryItemId
     ) links ON links.inventoryItemId = inv.id
     LEFT JOIN (
       SELECT inventoryItemId,
              SUM(CASE WHEN reason = 'sale' AND direction = 'out' THEN qty ELSE 0 END) AS saleUsage,
              SUM(CASE WHEN reason = 'waste' AND direction = 'out' THEN qty ELSE 0 END) AS wasteQty,
              SUM(CASE WHEN reason = 'correction' THEN qty ELSE 0 END) AS correctionQty,
              SUM(CASE WHEN reason = 'restock' AND direction = 'in' THEN qty ELSE 0 END) AS restockQty
       FROM inventory_movements
       WHERE createdAt >= ?
       GROUP BY inventoryItemId
     ) movements ON movements.inventoryItemId = inv.id
     WHERE inv.active = 1
     ORDER BY inv.stockQty <= 0 DESC, inv.nameEn ASC`,
    [since]
  );

  const allItems = (Array.isArray(rows) ? rows : []).map((row) =>
    deriveInventoryRisk(row, {
      lookbackDays: safeLookback,
      horizonDays: safeHorizon,
      now,
    })
  );
  const severityOrder = { critical: 0, high: 1, medium: 2, normal: 3 };
  const risks = allItems
    .filter((item) => includeNormal || item.severity !== 'normal' || item.linkedMenuItems === 0)
    .sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        (a.estimatedDaysRemaining ?? Infinity) - (b.estimatedDaysRemaining ?? Infinity)
    )
    .slice(0, safeLimit);

  return {
    source: ['inventory_items', 'inventory_movements', 'inventory_usage_rules'],
    generatedAt: now.getTime(),
    lookbackDays: safeLookback,
    horizonDays: safeHorizon,
    counts: {
      activeItems: allItems.length,
      critical: allItems.filter((item) => item.severity === 'critical').length,
      high: allItems.filter((item) => item.severity === 'high').length,
      medium: allItems.filter((item) => item.severity === 'medium').length,
      withoutConsumptionHistory: allItems.filter((item) => item.averageDailyUsage === 0).length,
    },
    risks,
    limitations: [
      'Stockout dates are estimates based only on recorded sale consumption.',
      'Supplier lead times and pending purchase orders are not stored.',
    ],
  };
}

export async function getInventoryMovementSummary(
  { inventoryItemId, lookbackDays = 30 } = {},
  db = pool,
  options = {}
) {
  const itemId = String(inventoryItemId || '').trim();
  if (!itemId) throw new Error('inventoryItemId is required');
  const safeLookback = Math.min(Math.max(Number(lookbackDays) || 30, 1), 365);
  const now = options.now instanceof Date ? options.now : new Date();
  const since = now.getTime() - safeLookback * 24 * 60 * 60 * 1000;
  const [itemRows] = await db.execute(
    `SELECT id, nameEn, nameAr, unit, stockQty, lowStockThreshold, active
     FROM inventory_items WHERE id = ? LIMIT 1`,
    [itemId]
  );
  const item = itemRows?.[0];
  if (!item) throw new Error('Inventory item not found');
  const [movementRows] = await db.execute(
    `SELECT reason, direction, COUNT(*) AS movementCount, COALESCE(SUM(qty), 0) AS qty
     FROM inventory_movements
     WHERE inventoryItemId = ? AND createdAt >= ?
     GROUP BY reason, direction
     ORDER BY reason ASC, direction ASC`,
    [itemId, since]
  );
  return {
    source: 'inventory_movements',
    period: { lookbackDays: safeLookback, fromTimestamp: since, toTimestamp: now.getTime() },
    item: {
      id: String(item.id),
      nameEn: String(item.nameEn || ''),
      nameAr: String(item.nameAr || ''),
      unit: String(item.unit || ''),
      stockQty: roundQty(item.stockQty),
      lowStockThreshold: roundQty(item.lowStockThreshold),
      active: asBoolean(item.active),
    },
    movements: (Array.isArray(movementRows) ? movementRows : []).map((row) => ({
      reason: String(row.reason || ''),
      direction: String(row.direction || ''),
      movementCount: Number(row.movementCount || 0),
      qty: roundQty(row.qty),
    })),
  };
}

export async function getInventoryDataQuality(db = pool) {
  const [rows] = await db.execute(`
    SELECT
      (SELECT COUNT(*)
       FROM items i
       LEFT JOIN inventory_usage_rules r ON r.menuItemId = i.id
       WHERE i.available = 1 AND r.id IS NULL) AS availableMenuItemsWithoutRules,
      (SELECT COUNT(*)
       FROM inventory_items inv
       LEFT JOIN inventory_usage_rules r ON r.inventoryItemId = inv.id
       WHERE inv.active = 1 AND r.id IS NULL) AS activeInventoryItemsWithoutRules,
      (SELECT COUNT(*) FROM inventory_items
       WHERE active = 1 AND lowStockThreshold <= 0) AS activeItemsWithoutThreshold,
      (SELECT COUNT(*) FROM inventory_items
       WHERE active = 1 AND stockQty < 0) AS negativeStockItems
  `);
  const row = rows?.[0] || {};
  const checks = {
    availableMenuItemsWithoutRules: Number(row.availableMenuItemsWithoutRules || 0),
    activeInventoryItemsWithoutRules: Number(row.activeInventoryItemsWithoutRules || 0),
    activeItemsWithoutThreshold: Number(row.activeItemsWithoutThreshold || 0),
    negativeStockItems: Number(row.negativeStockItems || 0),
  };
  return {
    source: ['items', 'inventory_items', 'inventory_usage_rules'],
    generatedAt: Date.now(),
    checks,
    hasWarnings: Object.values(checks).some((value) => value > 0),
    warnings: [
      checks.availableMenuItemsWithoutRules > 0
        ? `${checks.availableMenuItemsWithoutRules} available menu item(s) have no inventory consumption rule.`
        : null,
      checks.activeInventoryItemsWithoutRules > 0
        ? `${checks.activeInventoryItemsWithoutRules} active inventory item(s) are not linked to menu items.`
        : null,
      checks.activeItemsWithoutThreshold > 0
        ? `${checks.activeItemsWithoutThreshold} active inventory item(s) have no low-stock threshold.`
        : null,
      checks.negativeStockItems > 0
        ? `${checks.negativeStockItems} inventory item(s) have negative stock.`
        : null,
    ].filter(Boolean),
  };
}
