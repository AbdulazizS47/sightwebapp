import { describe, it, expect } from 'vitest';
import { validatePromotion, validateSelections } from './promotions.js';
import { selectFreeCoffeeReward } from './loyalty.js';
const products = [{ id: 'latte' }, { id: 'v60' }, { id: 'bundle', promotion: { count: 2 } }];
const offer = { count: 2, itemIds: ['latte', 'v60'], allowDuplicates: true };
describe('promotion rules', () => {
  it('rejects missing products, nested bundles and impossible selection counts', () => {
    for (const rule of [
      { ...offer, itemIds: ['missing'] },
      { ...offer, itemIds: ['bundle'] },
      { ...offer, count: 0 },
      { ...offer, count: 3, allowDuplicates: false },
    ])
      expect(() => validatePromotion(rule, products)).toThrow();
  });
  it('validates exact counts, eligibility, duplicate rules and malformed selections', () => {
    expect(() => validateSelections(offer, [{ id: 'latte' }, { id: 'latte' }])).not.toThrow();
    for (const choices of [
      [{ id: 'latte' }],
      [{ id: 'latte' }, { id: 'missing' }],
      [null, null],
      [{ id: 'v60', temperature: 'invalid' }, { id: 'latte' }],
    ])
      expect(() => validateSelections(offer, choices)).toThrow();
    expect(() =>
      validateSelections({ ...offer, allowDuplicates: false }, [{ id: 'latte' }, { id: 'latte' }])
    ).toThrow();
  });
  it('enforces start and end boundaries', () => {
    const choices = [{ id: 'latte' }, { id: 'v60' }];
    const scheduled = { ...offer, startsAt: 100, endsAt: 200 };
    expect(() => validateSelections(scheduled, choices, 99)).toThrow();
    expect(() => validateSelections(scheduled, choices, 100)).not.toThrow();
    expect(() => validateSelections(scheduled, choices, 200)).toThrow();
  });
  it('does not redeem a free coffee against a promo bundle', () => {
    expect(
      selectFreeCoffeeReward([{ id: 'bundle', category: 'v60', price: 9.6, promotion: offer }])
    ).toBeNull();
  });
});
