import { getLoyaltyCycleStamps, shouldAccrueLoyaltyPoint } from './loyalty.js';

const roundQty = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function hasRedeemedReward(order) {
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  return (items || []).some((item) => item.id === 'reward-discount' && Number(item.price) < 0);
}

// Older orders did not store their stamp contribution. Reconstruct it once, in
// chronological order, then persist it so later deletions cannot change the estimate.
export function inferLegacyLoyaltyEarnings(orders, cycleLength = 5) {
  let points = 0;
  return orders.map((order) => {
    const earned = order.loyaltyPointsEarned == null
      ? Number(shouldAccrueLoyaltyPoint({
          rewardWasAvailable: getLoyaltyCycleStamps(points, cycleLength) === cycleLength,
          rewardWasRedeemed: hasRedeemedReward(order),
        }))
      : Number(order.loyaltyPointsEarned);
    points += earned;
    return { id: order.id, earned };
  });
}

export async function deleteOrderAndRestore(db, orderId, actorId = null, cycleLength = 5) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Match order creation's lock order: customer, order, inventory. The second
    // read is a locking read, so duplicate/concurrent deletions cannot restore twice.
    const [lookup] = await conn.execute('SELECT userId FROM orders WHERE id = ?', [orderId]);
    if (lookup[0]?.userId) {
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [lookup[0].userId]);
    }
    const [orders] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) {
      await conn.rollback();
      return { deleted: false, restoredInventory: [] };
    }

    const [movements] = await conn.execute(
      'SELECT * FROM inventory_movements WHERE orderId = ? ORDER BY inventoryItemId, id FOR UPDATE',
      [orderId]
    );
    const quantities = new Map();
    for (const movement of movements) {
      const qty = Number(movement.qty);
      if (!Number.isFinite(qty) || qty < 0 || !['in', 'out'].includes(movement.direction)) {
        throw new Error('Invalid inventory movement; order was not deleted');
      }
      quantities.set(movement.inventoryItemId, roundQty(
        (quantities.get(movement.inventoryItemId) || 0) + (movement.direction === 'out' ? qty : -qty)
      ));
    }
    const restoredInventory = [];
    const now = Date.now();
    for (const [inventoryItemId, qty] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!qty) continue;
      const [items] = await conn.execute('SELECT * FROM inventory_items WHERE id = ? FOR UPDATE', [inventoryItemId]);
      if (!items[0]) throw new Error('Inventory item missing; order was not deleted');
      const stockQty = roundQty(Number(items[0].stockQty) + qty);
      await conn.execute(
        'UPDATE inventory_items SET stockQty = ?, lowStockAlertSentAt = ?, updatedAt = ? WHERE id = ?',
        [stockQty, stockQty > Number(items[0].lowStockThreshold) ? null : items[0].lowStockAlertSentAt, now, inventoryItemId]
      );
      // Keep the original and reversing movements for an auditable stock ledger.
      // Neither is counted as sale consumption after the order is deleted.
      await conn.execute(
        `INSERT INTO inventory_movements
         (inventoryItemId, direction, qty, reason, orderId, note, createdByUserId, createdAt)
         VALUES (?, ?, ?, 'order_deletion', NULL, ?, ?, ?)`,
        [inventoryItemId, qty > 0 ? 'in' : 'out', Math.abs(qty), `Deleted order ${order.orderNumber}`, actorId, now]
      );
      restoredInventory.push({ inventoryItemId, qty, stockQty });
    }
    await conn.execute(
      `UPDATE inventory_movements SET reason = 'deleted_order', orderId = NULL,
       note = CONCAT_WS(' | ', NULLIF(note, ''), ?) WHERE orderId = ?`,
      [`Original movement for deleted order ${order.orderNumber}`, orderId]
    );

    let loyaltyReconstructed = Boolean(Number(order.loyaltyPointsEstimated || 0));
    let loyaltyPointsChange = 0;
    if (order.userId) {
      const [accounts] = await conn.execute('SELECT points FROM loyalty_accounts WHERE userId = ? FOR UPDATE', [order.userId]);
      if (accounts[0]) {
        let earned = order.loyaltyPointsEarned;
        if (earned == null) {
          const [history] = await conn.execute(
            'SELECT id, items, loyaltyPointsEarned FROM orders WHERE userId = ? ORDER BY createdAt, id FOR UPDATE',
            [order.userId]
          );
          const estimates = inferLegacyLoyaltyEarnings(history, cycleLength);
          for (const estimate of estimates) {
            await conn.execute('UPDATE orders SET loyaltyPointsEarned = ?, loyaltyPointsEstimated = 1 WHERE id = ? AND loyaltyPointsEarned IS NULL', [estimate.earned, estimate.id]);
          }
          earned = estimates.find((entry) => entry.id === orderId)?.earned || 0;
          loyaltyReconstructed = true;
        }
        // The existing loyalty system advances a cumulative counter by one for
        // both ordinary and redeemed orders. Undo that exact contribution:
        // e.g. deleting the fifth (reward) order moves 5 back to 4, making it
        // available again. Orders that skipped an available reward earned zero.
        const delta = -Number(earned);
        const nextPoints = Math.max(0, Number(accounts[0].points) + delta);
        loyaltyPointsChange = nextPoints - Number(accounts[0].points);
        await conn.execute('UPDATE loyalty_accounts SET points = ? WHERE userId = ?', [nextPoints, order.userId]);
      }
    }

    await conn.execute('DELETE FROM print_jobs WHERE orderId = ?', [orderId]);
    // Revenue, customer history and discount usage are derived from orders.
    // Counters deliberately stay monotonic so a deleted ID is never reused.
    await conn.execute('DELETE FROM orders WHERE id = ?', [orderId]);
    await conn.commit();
    return { deleted: true, restoredInventory, loyaltyPointsChange, loyaltyReconstructed };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
