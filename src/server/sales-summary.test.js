import { describe, expect, it } from 'vitest';
import {
  buildSalesSummaryMessage,
  loadSalesSummary,
  normalizeDateKey,
  shiftDateKey,
} from './sales-summary.js';

describe('sales summary helpers', () => {
  it('validates and shifts report dates', () => {
    expect(normalizeDateKey('2026-07-22')).toBe('20260722');
    expect(normalizeDateKey('2026-02-30')).toBeNull();
    expect(shiftDateKey('2026-03-01', -1)).toBe('20260228');
  });

  it('builds a concise Telegram report', () => {
    const message = buildSalesSummaryMessage({
      dateKey: '20260722',
      orders: 4,
      completed: 3,
      pending: 1,
      revenue: 100,
      averageOrder: 25,
      discounts: 9,
      uniqueCustomers: 3,
      payments: [{ method: 'card', orders: 4, revenue: 100 }],
      topItems: [{ name: 'V60', quantity: 3, revenue: 30 }],
    });

    expect(message).toContain('SIGHT sales — 2026-07-22');
    expect(message).toContain('Revenue: 100.00 SAR');
    expect(message).toContain('Orders: 4 (3 completed, 1 pending)');
    expect(message).toContain('1. V60 — 3 sold');
  });

  it('aggregates orders, customers, payments, discounts, and item quantities', async () => {
    const db = {
      execute: async () => [
        [
          {
            items: JSON.stringify([{ nameEn: 'V60', quantity: 2, price: 15 }]),
            total: '30.00',
            paymentMethod: 'card',
            completedAt: 123,
            discountAmount: '0.00',
            phoneNumber: '966500000001',
            userId: null,
          },
          {
            items: [{ nameEn: 'V60', quantity: 1, price: 15 }],
            total: '15.00',
            paymentMethod: 'cash',
            completedAt: null,
            discountAmount: '9.00',
            phoneNumber: '966500000001',
            userId: null,
          },
        ],
      ],
    };

    const summary = await loadSalesSummary('2026-07-22', db);
    expect(summary).toMatchObject({
      orders: 2,
      completed: 1,
      pending: 1,
      revenue: 45,
      averageOrder: 22.5,
      discounts: 9,
      uniqueCustomers: 1,
    });
    expect(summary.topItems[0]).toMatchObject({ name: 'V60', quantity: 3, revenue: 45 });
  });
});
