import { describe, expect, it } from 'vitest';
import {
  daysBetweenInclusive,
  normalizeDateRange,
  shiftDateKey,
} from './date-utils.js';
import { deriveInventoryRisk } from './inventory.js';
import { aggregateSalesRows } from './sales.js';

describe('operations date utilities', () => {
  it('normalizes bounded inclusive ranges', () => {
    expect(
      normalizeDateRange(
        { fromDate: '2026-08-01', toDate: '2026-08-04' },
        { todayDateKey: '20260804' }
      )
    ).toEqual({ fromDate: '20260801', toDate: '20260804', days: 4 });
    expect(daysBetweenInclusive('20260228', '20260301')).toBe(2);
    expect(shiftDateKey('20260301', -1)).toBe('20260228');
  });

  it('rejects reversed and oversized ranges', () => {
    expect(() =>
      normalizeDateRange(
        { fromDate: '2026-08-04', toDate: '2026-08-01' },
        { todayDateKey: '20260804' }
      )
    ).toThrow('Invalid date range');
    expect(() =>
      normalizeDateRange(
        { fromDate: '2024-01-01', toDate: '2026-08-04' },
        { todayDateKey: '20260804', maxDays: 366 }
      )
    ).toThrow('cannot exceed');
  });
});

describe('sales operations aggregation', () => {
  it('keeps financial calculations deterministic and excludes customer identities', () => {
    const result = aggregateSalesRows(
      [
        {
          dateKey: '20260804',
          userId: 'user-1',
          phoneNumber: '966500000001',
          items: JSON.stringify([{ id: 'v60', nameEn: 'V60', quantity: 2, price: 15 }]),
          total: '30.00',
          discountCode: null,
          discountAmount: '0.00',
          paymentMethod: 'card',
          completedAt: 1,
        },
        {
          dateKey: '20260804',
          userId: 'user-1',
          phoneNumber: '966500000001',
          items: [{ id: 'v60', nameEn: 'V60', quantity: 1, price: 15 }],
          total: '15.00',
          discountCode: 'MISSU',
          discountAmount: '9.00',
          paymentMethod: 'cash',
          completedAt: null,
        },
      ],
      { fromDate: '20260804', toDate: '20260804', days: 1 }
    );

    expect(result.metrics).toEqual({
      revenue: 45,
      orders: 2,
      completedOrders: 1,
      pendingOrders: 1,
      averageOrderValue: 22.5,
      discounts: 9,
      uniqueCustomers: 1,
    });
    expect(result.products[0]).toMatchObject({ id: 'v60', quantity: 3, revenue: 45 });
    expect(JSON.stringify(result)).not.toContain('966500000001');
    expect(result.limitations.join(' ')).toContain('Profit');
  });
});

describe('inventory risk derivation', () => {
  it('estimates days remaining from recorded sale consumption', () => {
    const risk = deriveInventoryRisk(
      {
        id: 'bean-1',
        nameEn: 'Ethiopia',
        nameAr: 'إثيوبيا',
        type: 'bean',
        unit: 'g',
        stockQty: 700,
        lowStockThreshold: 300,
        saleUsage: 1400,
        wasteQty: 50,
        correctionQty: 0,
        restockQty: 1000,
        linkedMenuItems: 2,
      },
      { lookbackDays: 14, horizonDays: 7, now: new Date('2026-08-04T00:00:00Z') }
    );
    expect(risk).toMatchObject({
      averageDailyUsage: 100,
      estimatedDaysRemaining: 7,
      severity: 'high',
      linkedMenuItems: 2,
    });
    expect(risk.estimatedStockoutAt).toBe('2026-08-11T00:00:00.000Z');
  });

  it('labels missing consumption history as an unknown estimate', () => {
    const risk = deriveInventoryRisk(
      {
        id: 'sweet-1',
        nameEn: 'Cookie',
        type: 'sweet',
        unit: 'pcs',
        stockQty: 10,
        lowStockThreshold: 3,
        saleUsage: 0,
      },
      { lookbackDays: 14, horizonDays: 7, now: new Date('2026-08-04T00:00:00Z') }
    );
    expect(risk.estimatedDaysRemaining).toBeNull();
    expect(risk.estimateBasis).toContain('No recorded');
  });
});
