import { describe, expect, it } from 'vitest';
import {
  getLoyaltyCycleStamps,
  selectFreeCoffeeReward,
  shouldAccrueLoyaltyPoint,
} from './loyalty.js';

describe('getLoyaltyCycleStamps', () => {
  it('has no reward before any orders are completed', () => {
    expect(getLoyaltyCycleStamps(0)).toBe(0);
  });

  it('makes the 5th order free after 4 completed orders, not the 6th', () => {
    // Regression test: a (points - 1) % cycle formula makes the reward land on order 6
    // instead of order 5. Reported by a real customer (order #10 wrongly refused).
    expect(getLoyaltyCycleStamps(4)).toBe(5);
    expect(getLoyaltyCycleStamps(3)).toBe(4);
    expect(getLoyaltyCycleStamps(5)).toBe(1); // fresh cycle right after the reward order
  });

  it('makes every 5th order free thereafter (10th, 15th, ...)', () => {
    expect(getLoyaltyCycleStamps(9)).toBe(5);
    expect(getLoyaltyCycleStamps(14)).toBe(5);
    expect(getLoyaltyCycleStamps(19)).toBe(5);
    expect(getLoyaltyCycleStamps(8)).toBe(4);
    expect(getLoyaltyCycleStamps(10)).toBe(1);
  });

  it('supports a non-default cycle length', () => {
    expect(getLoyaltyCycleStamps(2, 3)).toBe(3);
    expect(getLoyaltyCycleStamps(1, 3)).toBe(2);
  });
});

describe('shouldAccrueLoyaltyPoint', () => {
  it('accrues normally while no reward is available yet', () => {
    expect(shouldAccrueLoyaltyPoint({ rewardWasAvailable: false, rewardWasRedeemed: false })).toBe(
      true
    );
  });

  it('accrues when the reward was available and actually redeemed', () => {
    expect(shouldAccrueLoyaltyPoint({ rewardWasAvailable: true, rewardWasRedeemed: true })).toBe(
      true
    );
  });

  it('freezes the count when a reward was available but not redeemed', () => {
    // Regression test: a customer who skips redeeming on their free-cup order must not lose
    // it — the reward should still be offered on every order after, not just the one where it
    // was first earned. Reported by a real customer whose reward vanished until 4 more orders.
    expect(shouldAccrueLoyaltyPoint({ rewardWasAvailable: true, rewardWasRedeemed: false })).toBe(
      false
    );
  });
});

describe('selectFreeCoffeeReward', () => {
  it('does not use a higher-priced sweet as the fifth-order reward', () => {
    const reward = selectFreeCoffeeReward([
      { id: 'espresso', nameEn: 'Espresso', category: 'coffee', price: 9, quantity: 1 },
      { id: 'cake', nameEn: 'Cake', category: 'sweets', price: 25, quantity: 1 },
    ], 9);

    expect(reward?.item.id).toBe('espresso');
    expect(reward?.unitPrice).toBe(9);
  });

  it('makes only one coffee unit free when quantity is greater than one', () => {
    const reward = selectFreeCoffeeReward([
      { id: 'v60', nameEn: 'V60', category: 'v60', price: 18, quantity: 4 },
    ], 9);

    expect(reward?.unitPrice).toBe(9);
  });

  it('does not apply a free-cup reward when the cart has no coffee', () => {
    const reward = selectFreeCoffeeReward([
      { id: 'brownie', nameEn: 'Brownie', category: 'pastries', price: 22, quantity: 1 },
      { id: 'matcha', nameEn: 'Matcha', category: 'not-coffee', price: 20, quantity: 1 },
    ]);

    expect(reward).toBeNull();
  });

  it('does not treat an unrelated retail category as coffee', () => {
    const reward = selectFreeCoffeeReward([
      { id: 'coffee-beans-bag', nameEn: 'Coffee Beans Bag', category: 'retail', price: 80 },
    ]);

    expect(reward).toBeNull();
  });

  it('deducts only the coffee value from a Coffee + sweet bundle', () => {
    const reward = selectFreeCoffeeReward(
      [
        {
          id: 'sight-choco-v60',
          nameEn: 'SIGHT CHOCO + V60',
          category: 'coffee-sweet-y0mp25',
          categoryNameEn: 'Coffee + sweet',
          price: 25,
          quantity: 1,
        },
      ],
      9
    );

    expect(reward?.item.id).toBe('sight-choco-v60');
    expect(reward?.unitPrice).toBe(9);
  });
});
