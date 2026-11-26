import { useMemo, useState, type FormEvent } from 'react';
import { api, isApiClientError } from '../api/client';
import type { Product, SalesOrder } from '../api/types';
import { formatIDR } from '../utils/format';
import {
  parsePositiveInt,
  validateCreateOrderForm,
  type OrderItemDraft,
} from '../utils/validation';

interface CreateOrderPanelProps {
  products: Product[];
  onOrderCreated: (order: SalesOrder) => void;
  onViewOrder: (orderId: number) => void;
}

interface StockConflict {
  sku: string;
  available: number;
  message: string;
}

let rowCounter = 1;
function createEmptyRow(defaultSku = ''): OrderItemDraft {
  rowCounter += 1;
  return { id: `row-${rowCounter}`, sku: defaultSku, qty: '1' };
}

export function CreateOrderPanel({
  products,
  onOrderCreated,
  onViewOrder,
}: CreateOrderPanelProps) {
  const [customer, setCustomer] = useState('');
  const [items, setItems] = useState<OrderItemDraft[]>(() => [
    createEmptyRow(products[0]?.sku ?? ''),
  ]);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState<StockConflict | null>(null);
  const [createdOrder, setCreatedOrder] = useState<SalesOrder | null>(null);

  const productBySku = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.sku, p);
    }
    return map;
  }, [products]);

  const estimatedTotal = useMemo(() => {
    let sum = 0;
    for (const row of items) {
      const prod = productBySku.get(row.sku.trim());
      const qty = parsePositiveInt(row.qty);
      if (prod && qty !== null) {
        sum += prod.price * qty;
      }
    }
    return sum;
  }, [items, productBySku]);

  function updateRow(id: string, patch: Partial<Omit<OrderItemDraft, 'id'>>) {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setConflict(null);
  }

  function addRow() {
    const usedSkus = new Set(items.map((i) => i.sku));
    const nextProduct = products.find((p) => !usedSkus.has(p.sku));
    setItems((prev) => [...prev, createEmptyRow(nextProduct?.sku ?? '')]);
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((row) => row.id !== id));
    setConflict(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setConflict(null);
    setCreatedOrder(null);

    const validation = validateCreateOrderForm({ customer, items });
    if (!validation.valid || !validation.data) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    setSaving(true);
    try {
      const order = await api.createOrder(validation.data);
      setCreatedOrder(order);
      setCustomer('');
      setItems([createEmptyRow(products[0]?.sku ?? '')]);
      onOrderCreated(order);
    } catch (err: unknown) {
      if (isApiClientError(err) && err.code === 'INSUFFICIENT_STOCK') {
        const failedSku = err.sku ?? '';
        const available = err.available ?? 0;
        setConflict({
          sku: failedSku,
          available,
          message: err.message,
        });
      } else if (isApiClientError(err) && err.status === 400) {
        setValidationErrors(
          err.details && err.details.length > 0 ? err.details : [err.message],
        );
      } else if (isApiClientError(err)) {
        setValidationErrors([err.message]);
      } else {
        setValidationErrors(['Unexpected error while creating order.']);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Create sales order">
      <div className="panel-header">
        <h2>Create Sales Order</h2>
      </div>

      <div className="panel-body">
        {validationErrors.length > 0 && (
          <div className="alert alert-error" role="alert">
            <div className="alert-title">Order Validation Error</div>
            <ul>
              {validationErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {conflict && (
          <div className="alert alert-error" role="alert">
            <div className="alert-title">
              Insufficient Stock (409 INSUFFICIENT_STOCK)
            </div>
            <div>
              SKU <strong className="mono">{conflict.sku || 'unknown'}</strong>{' '}
              failed — only <strong>{conflict.available}</strong> available. No
              stock was deducted and no order was created.
            </div>
          </div>
        )}

        {createdOrder && (
          <div className="alert alert-success" role="status">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div className="alert-title">
                  Order #{createdOrder.id} Created — {createdOrder.customer}
                </div>
                <div>
                  Server-computed total:{' '}
                  <strong>{formatIDR(createdOrder.total)}</strong> (
                  {createdOrder.items.length} item
                  {createdOrder.items.length === 1 ? '' : 's'})
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onViewOrder(createdOrder.id)}
              >
                View Order Detail
              </button>
            </div>

            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit Price</th>
                    <th className="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {createdOrder.items.map((it) => (
                    <tr key={it.id}>
                      <td className="mono">{it.sku}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{formatIDR(it.unit_price)}</td>
                      <td className="num">{formatIDR(it.qty * it.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label className="form-label" htmlFor="order-customer">
              Customer Name
            </label>
            <input
              id="order-customer"
              type="text"
              className="field-input"
              placeholder="e.g. PT Karya Mandiri"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span className="form-label" style={{ marginBottom: 0 }}>
                Order Items
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={saving}
                onClick={addRow}
              >
                + Add Item
              </button>
            </div>

            {items.map((row, idx) => {
              const isConflictRow =
                conflict !== null &&
                conflict.sku.length > 0 &&
                row.sku.trim() === conflict.sku;

              return (
                <div
                  key={row.id}
                  className={`order-item-row ${isConflictRow ? 'row-conflict' : ''}`}
                >
                  <div>
                    <label
                      className="form-label"
                      htmlFor={`order-sku-${row.id}`}
                    >
                      Product #{idx + 1}
                    </label>
                    <select
                      id={`order-sku-${row.id}`}
                      className="field-select"
                      value={row.sku}
                      onChange={(e) => updateRow(row.id, { sku: e.target.value })}
                      disabled={saving}
                    >
                      <option value="">Select product SKU...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.sku}>
                          {p.sku} — {p.name} ({formatIDR(p.price)} · Stock: {p.stock})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      className="form-label"
                      htmlFor={`order-qty-${row.id}`}
                    >
                      Qty
                    </label>
                    <input
                      id={`order-qty-${row.id}`}
                      type="text"
                      inputMode="numeric"
                      className="field-input"
                      value={row.qty}
                      onChange={(e) => updateRow(row.id, { qty: e.target.value })}
                      disabled={saving}
                    />
                  </div>

                  <div style={{ paddingTop: 26 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-outline"
                      disabled={saving || items.length <= 1}
                      onClick={() => removeRow(row.id)}
                    >
                      Remove
                    </button>
                  </div>

                  {isConflictRow && conflict && (
                    <div className="row-conflict-note">
                      Insufficient stock for {conflict.sku}: available quantity is{' '}
                      {conflict.available}.
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Estimated preview (unit prices &amp; total are computed server-side)
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {formatIDR(estimatedTotal)}
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Creating Order...' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
