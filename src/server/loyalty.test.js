import { describe, expect, it } from 'vitest';
import { selectFreeCoffeeReward } from './loyalty.js';

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
