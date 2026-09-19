import { describe, expect, it } from 'vitest';
import { hasRedeemedReward, inferLegacyLoyaltyEarnings } from './order-deletion.js';

describe('legacy loyalty reconstruction', () => {
  it('distinguishes skipped rewards, redemptions and ordinary orders', () => {
    const orders = Array.from({ length: 8 }, (_, index) => ({ id: `${index}`, items: [] }));
    orders[6].items = [{ id: 'reward-discount', price: -9 }];
    expect(inferLegacyLoyaltyEarnings(orders).map((o) => o.earned)).toEqual([1, 1, 1, 1, 0, 0, 1, 1]);
  });
  it('honors exact recorded contributions and parses stored JSON rewards', () => {
    expect(inferLegacyLoyaltyEarnings([{id: 'one', items: '[]', loyaltyPointsEarned: 0}])[0].earned).toBe(0);
    expect(hasRedeemedReward({items: '[{"id":"reward-discount","price":-9}]'})).toBe(true);
    expect(hasRedeemedReward({items: [{id: 'discount-code', price: -9}]})).toBe(false);
  });
});
