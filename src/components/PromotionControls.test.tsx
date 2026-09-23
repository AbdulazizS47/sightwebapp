import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { PromotionPicker, promoKey } from './PromotionControls';
afterEach(cleanup);
const drinks = [
  { id: 'latte', nameEn: 'Latte', nameAr: 'لاتيه', price: 12, category: 'coffee', available: true },
  { id: 'v60', nameEn: 'V60', nameAr: 'قهوة', price: 15, category: 'v60', available: true },
];
const promo = {
  ...drinks[0],
  id: 'promo',
  nameEn: 'Two drinks',
  price: 9.6,
  promotion: { count: 2, itemIds: ['latte', 'v60'], allowDuplicates: true },
};
describe('promotion picker', () => {
  it('requires every choice and preserves each temperature', () => {
    const add = vi.fn();
    render(
      <PromotionPicker item={promo} items={drinks} language="en" onClose={() => {}} onAdd={add} />
    );
    const button = screen.getByRole('button', { name: 'Add promotion to cart' });
    expect(button).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Choice 1' })).getByRole('button', { name: 'Latte' })
    );
    expect(button).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Choice 2' })).getByRole('button', {
        name: 'V60 Hot',
      })
    );
    fireEvent.click(button);
    expect(add).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'latte' }),
      expect.objectContaining({ id: 'v60', temperature: 'hot' }),
    ]);
  });
  it('prevents duplicate choices and omits unavailable products', () => {
    render(
      <PromotionPicker
        item={{ ...promo, promotion: { ...promo.promotion, allowDuplicates: false } }}
        items={[...drinks, { ...drinks[0], id: 'sold', available: false }]}
        language="en"
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Choice 1' })).getByRole('button', { name: 'Latte' })
    );
    expect(
      within(screen.getByRole('group', { name: 'Choice 2' })).getByRole('button', { name: 'Latte' })
    ).toBeDisabled();
  });
  it('groups equivalent combinations but separates different temperatures', () => {
    const a = { ...drinks[0] };
    const b = { ...drinks[1], temperature: 'hot' as const };
    expect(promoKey('promo', [a, b])).toBe(promoKey('promo', [b, a]));
    expect(promoKey('promo', [a, b])).not.toBe(
      promoKey('promo', [a, { ...b, temperature: 'iced' }])
    );
  });
});
