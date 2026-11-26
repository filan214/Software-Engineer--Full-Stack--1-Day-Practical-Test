import type {
  AdjustStockPayload,
  CreateOrderPayload,
  CreateProductPayload,
  StockMovementType,
} from '../api/types';

const UNSIGNED_INT_PATTERN = /^\d+$/;

export function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!UNSIGNED_INT_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!UNSIGNED_INT_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  data: T | null;
}

export interface ProductFormInput {
  sku: string;
  name: string;
  price: string;
  is_active: boolean;
}

export function validateProductForm(
  input: ProductFormInput,
): ValidationResult<CreateProductPayload> {
  const errors: string[] = [];
  const sku = input.sku.trim();
  const name = input.name.trim();
  const price = parseNonNegativeInt(input.price);

  if (sku.length === 0) {
    errors.push('SKU is required.');
  }
  if (name.length === 0) {
    errors.push('Product name is required.');
  }
  if (price === null) {
    errors.push('Price must be a whole number >= 0 (IDR).');
  }

  if (errors.length > 0 || price === null) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      sku,
      name,
      price,
      is_active: input.is_active,
    },
  };
}

export interface AdjustStockFormInput {
  type: StockMovementType;
  qty: string;
  note: string;
}

export function validateAdjustStockForm(
  input: AdjustStockFormInput,
): ValidationResult<AdjustStockPayload> {
  const errors: string[] = [];
  if (input.type !== 'in' && input.type !== 'out') {
    errors.push("Direction must be 'in' or 'out'.");
  }

  const qty = parsePositiveInt(input.qty);
  if (qty === null) {
    errors.push('Quantity must be a whole number greater than 0.');
  }

  if (errors.length > 0 || qty === null) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      type: input.type,
      qty,
      note: input.note.trim(),
    },
  };
}

export interface OrderItemDraft {
  id: string;
  sku: string;
  qty: string;
}

export interface CreateOrderFormInput {
  customer: string;
  items: OrderItemDraft[];
}

export function validateCreateOrderForm(
  input: CreateOrderFormInput,
): ValidationResult<CreateOrderPayload> {
  const errors: string[] = [];
  const customer = input.customer.trim();
  if (customer.length === 0) {
    errors.push('Customer name is required.');
  }

  if (input.items.length === 0) {
    errors.push('Add at least one order item.');
  }

  const seenSkus = new Set<string>();
  const duplicateSkus = new Set<string>();
  const parsedItems: Array<{ sku: string; qty: number }> = [];

  input.items.forEach((item, index) => {
    const rowNum = index + 1;
    const sku = item.sku.trim();
    const qty = parsePositiveInt(item.qty);

    if (sku.length === 0) {
      errors.push(`Row ${rowNum}: Select or enter a SKU.`);
    } else if (seenSkus.has(sku)) {
      if (!duplicateSkus.has(sku)) {
        duplicateSkus.add(sku);
        errors.push(`Duplicate SKU "${sku}" in order — combine quantities into one row.`);
      }
    } else {
      seenSkus.add(sku);
    }

    if (qty === null) {
      errors.push(`Row ${rowNum}: Quantity must be an integer > 0.`);
    }

    if (sku.length > 0 && qty !== null) {
      parsedItems.push({ sku, qty });
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      customer,
      items: parsedItems,
    },
  };
}
