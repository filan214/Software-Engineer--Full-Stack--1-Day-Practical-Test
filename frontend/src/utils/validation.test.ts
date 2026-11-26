import { describe, expect, it } from 'vitest';
import {
  parseNonNegativeInt,
  parsePositiveInt,
  validateAdjustStockForm,
  validateCreateOrderForm,
  validateProductForm,
} from './validation';

describe('integer parsers', () => {
  it('parsePositiveInt accepts only whole integers > 0', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt(' 42 ')).toBe(42);
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-5')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('12abc')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
  });

  it('parseNonNegativeInt allows 0 and rejects floats/negatives', () => {
    expect(parseNonNegativeInt('0')).toBe(0);
    expect(parseNonNegativeInt('850000')).toBe(850000);
    expect(parseNonNegativeInt('-1')).toBeNull();
    expect(parseNonNegativeInt('99.9')).toBeNull();
  });
});

describe('validateProductForm', () => {
  it('accepts valid product input and trims strings', () => {
    const res = validateProductForm({
      sku: ' SKU-900 ',
      name: ' Label Printer ',
      price: '1250000',
      is_active: true,
    });
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({
      sku: 'SKU-900',
      name: 'Label Printer',
      price: 1250000,
      is_active: true,
    });
  });

  it('rejects missing fields and non-integer prices', () => {
    const res = validateProductForm({
      sku: '   ',
      name: '',
      price: '10.5',
      is_active: false,
    });
    expect(res.valid).toBe(false);
    expect(res.errors).toHaveLength(3);
  });
});

describe('validateAdjustStockForm', () => {
  it('accepts valid in/out adjustment', () => {
    const res = validateAdjustStockForm({
      type: 'out',
      qty: '5',
      note: ' Damaged boxes ',
    });
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({ type: 'out', qty: 5, note: 'Damaged boxes' });
  });

  it('rejects zero, negative, and decimal quantities', () => {
    expect(validateAdjustStockForm({ type: 'in', qty: '0', note: '' }).valid).toBe(false);
    expect(validateAdjustStockForm({ type: 'out', qty: '-3', note: '' }).valid).toBe(false);
    expect(validateAdjustStockForm({ type: 'out', qty: '2.5', note: '' }).valid).toBe(false);
  });
});

describe('validateCreateOrderForm', () => {
  it('accepts valid multi-item order', () => {
    const res = validateCreateOrderForm({
      customer: ' PT Nusantara ',
      items: [
        { id: '1', sku: 'SKU-001', qty: '2' },
        { id: '2', sku: 'SKU-002', qty: '5' },
      ],
    });
    expect(res.valid).toBe(true);
    expect(res.data).toEqual({
      customer: 'PT Nusantara',
      items: [
        { sku: 'SKU-001', qty: 2 },
        { sku: 'SKU-002', qty: 5 },
      ],
    });
  });

  it('rejects empty customer, empty items, duplicate SKUs, and bad qty', () => {
    const emptyRes = validateCreateOrderForm({ customer: '', items: [] });
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.errors.length).toBeGreaterThanOrEqual(2);

    const dupRes = validateCreateOrderForm({
      customer: 'Buyer',
      items: [
        { id: '1', sku: 'SKU-001', qty: '1' },
        { id: '2', sku: 'SKU-001', qty: '0' },
      ],
    });
    expect(dupRes.valid).toBe(false);
    expect(dupRes.errors.some((e) => e.includes('Duplicate SKU'))).toBe(true);
    expect(dupRes.errors.some((e) => e.includes('integer > 0'))).toBe(true);
  });
});
