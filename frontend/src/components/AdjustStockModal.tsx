import { useState, type FormEvent } from 'react';
import { api, isApiClientError } from '../api/client';
import type { Product, StockMovementType } from '../api/types';
import { validateAdjustStockForm } from '../utils/validation';

interface AdjustStockModalProps {
  product: Product;
  onClose: () => void;
  onAdjusted: () => void;
}

interface StockErrorBanner {
  title: string;
  message: string;
  available?: number;
}

export function AdjustStockModal({
  product,
  onClose,
  onAdjusted,
}: AdjustStockModalProps) {
  const [direction, setDirection] = useState<StockMovementType>('in');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState<StockErrorBanner | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError(null);

    const validation = validateAdjustStockForm({
      type: direction,
      qty,
      note,
    });
    if (!validation.valid || !validation.data) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    setSaving(true);
    try {
      await api.adjustStock(product.id, validation.data);
      onAdjusted();
    } catch (err: unknown) {
      if (isApiClientError(err) && err.code === 'INSUFFICIENT_STOCK') {
        const available = err.available ?? 0;
        setApiError({
          title: `Insufficient Stock (409 ${err.code})`,
          message: `Cannot deduct ${validation.data.qty} units from ${product.sku}. Available stock on server: ${available}.`,
          available,
        });
      } else if (isApiClientError(err)) {
        setApiError({
          title: `Adjustment Failed (${err.status || err.code})`,
          message: err.message,
        });
      } else {
        setApiError({
          title: 'Adjustment Failed',
          message: 'Unexpected error while adjusting stock.',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-stock-title"
    >
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="adjust-stock-title">Adjust Stock — {product.sku}</h3>
          <button
            type="button"
            className="btn btn-sm"
            disabled={saving}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="modal-body">
            <div className="meta-grid">
              <div>
                <div className="meta-label">Product</div>
                <div className="meta-value">{product.name}</div>
              </div>
              <div>
                <div className="meta-label">Current Stock</div>
                <div className="meta-value">
                  {apiError?.available !== undefined
                    ? `${apiError.available} (server)`
                    : product.stock}
                </div>
              </div>
            </div>

            {validationErrors.length > 0 && (
              <div className="alert alert-error" role="alert">
                <div className="alert-title">Validation Error</div>
                <ul>
                  {validationErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {apiError && (
              <div className="alert alert-error" role="alert">
                <div className="alert-title">{apiError.title}</div>
                <div>{apiError.message}</div>
                {apiError.available !== undefined && (
                  <div style={{ marginTop: 6, fontWeight: 700 }}>
                    Available quantity: {apiError.available}
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <span className="form-label">Direction</span>
              <div className="segmented">
                <button
                  type="button"
                  className={`segmented-btn ${direction === 'in' ? 'active-in' : ''}`}
                  disabled={saving}
                  onClick={() => {
                    setDirection('in');
                    setApiError(null);
                  }}
                >
                  + Stock In
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${direction === 'out' ? 'active-out' : ''}`}
                  disabled={saving}
                  onClick={() => {
                    setDirection('out');
                    setApiError(null);
                  }}
                >
                  − Stock Out
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="adjust-qty">
                Quantity (integer &gt; 0)
              </label>
              <input
                id="adjust-qty"
                type="text"
                inputMode="numeric"
                className="field-input"
                placeholder="Enter positive integer"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="adjust-note">
                Note (optional)
              </label>
              <input
                id="adjust-note"
                type="text"
                className="field-input"
                placeholder="e.g. Supplier delivery PO-2001 or damaged unit write-off"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
