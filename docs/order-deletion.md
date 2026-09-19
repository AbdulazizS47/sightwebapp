# Order deletion

Admins can delete an order from its Order History card after confirming. The API is
`DELETE /api/admin/orders/:id`, using the existing admin authentication. It accepts
the full `order:YYYYMMDD-NNN` ID or order number. An already absent order succeeds
without restoring anything a second time.

One MySQL transaction locks the customer (when present), order and affected stock,
restores the net quantities from the original inventory movements, reverses the
order's stamp contribution, removes print jobs, and deletes the order. Revenue,
order/customer history and discount usage counts are derived from the orders table
and therefore update with deletion. Order counters are never decremented.

Original stock movements remain labeled `deleted_order` and a matching
`order_deletion` movement records the restoration and acting admin. Both have no
foreign-key link to the removed order and carry its number in their note. This
preserves the stock ledger while excluding the deleted sale from consumption
estimates. Recipes are never used to calculate a restoration: historical orders
without recorded inventory deductions restore no stock.

New orders store `loyaltyPointsEarned` inside the same transaction as their stock
changes. Removing their contribution reverses the existing cumulative loyalty
counter. For example, deleting reward order five returns five points to four,
which makes the reward available again. Skipping an available reward earns zero
and deleting that order removes zero. Other orders' contributions are unchanged.

Older orders lack per-order stamp data. Their contributions are estimated from
chronological order history using the current loyalty rules, then stored with
`loyaltyPointsEstimated = 1`. Historical rule changes or manual account changes
cannot be reconstructed exactly; the UI displays a notice for these deletions.
The account's opt-in status is preserved. Startup adds both columns automatically
and fails on migration errors other than an already-existing column.

Deletion does not refund a payment or undo an already delivered receipt/message.
The confirmation explicitly says that no payment refund is issued.

Inventory refreshes every ten seconds while visible and when the window regains
focus. Open movement history reloads when the item's update timestamp changes.
The movement endpoint uses a bounded integer SQL limit to avoid the deployed
MySQL prepared-statement LIMIT error.

## Verification

- `npx vitest run`: unit/component suite (local MySQL suite is opt-in).
- `SIGHT_TEST_MYSQL=1 npx vitest run src/server/order-deletion.mysql.test.js`:
  creates and drops only a unique test database on localhost; tests rollback,
  concurrent duplicate deletes, recorded stock restoration, loyalty, guest orders,
  legacy records and print-job removal.
- `SIGHT_TEST_MYSQL=1 npx vitest run src/server/order-lifecycle.mysql.test.js`:
  starts the actual API with a disposable local database, checks repeatable schema
  upgrades, customer/cashier checkout, admin-only deletion, reward pricing,
  changed recipes, concurrent creation/deletion, discount reuse and stock shortages.
- `npm run build`.
