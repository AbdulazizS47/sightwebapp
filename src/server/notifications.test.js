import { describe, expect, it } from 'vitest';
import { buildInventoryLowStockMessage } from './notifications.js';

describe('buildInventoryLowStockMessage', () => {
  it('formats grams with decimals and includes the inventory link target label', () => {
    const message = buildInventoryLowStockMessage({
      id: 'ethiopia-guji',
      nameEn: 'Ethiopia Guji',
      unit: 'g',
      stockQty: 180.5,
      lowStockThreshold: 200,
    });

    expect(message).toContain('Low stock alert: Ethiopia Guji');
    expect(message).toContain('Current stock: 180.50 g');
    expect(message).toContain('Low stock limit: 200 g');
    expect(message).toContain('Item ID: ethiopia-guji');
  });

  it('formats piece-based inventory as whole numbers', () => {
    const message = buildInventoryLowStockMessage({
      id: 'cookie-box',
      nameEn: 'Cookie Box',
      unit: 'pcs',
      stockQty: 3,
      lowStockThreshold: 5,
    });

    expect(message).toContain('Current stock: 3 pcs');
    expect(message).toContain('Low stock limit: 5 pcs');
  });
});
