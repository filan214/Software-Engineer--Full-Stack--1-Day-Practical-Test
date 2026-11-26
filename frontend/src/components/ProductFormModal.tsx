import { useState, type FormEvent } from 'react';
import { api, isApiClientError } from '../api/client';
import type { Product } from '../api/types';
import { validateProductForm } from '../utils/validation';

interface ProductFormModalProps {
  product: Product | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

export function ProductFormModal({
  product,
  onClose,
  onSaved,
}: ProductFormModalProps) {
  const isEdit = product !== null;
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validation = validateProductForm({
      sku,
      name,
      price,
      is_active: isActive,
    });
    if (!validation.valid || !validation.data) {
      setErrors(validation.errors);
      return;
    }

    setErrors([]);
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateProduct(product.id, validation.data);
      } else {
        await api.createProduct(validation.data);
      }
      onSaved();
    } catch (err: unknown) {
      if (isApiClientError(err)) {
        setErrors(
          err.details && err.details.length > 0 ? err.details : [err.message],
        );
      } else {
        setErrors(['Unexpected error while saving product.']);
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
      aria-labelledby="product-modal-title"
    >
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="product-modal-title">
            {isEdit ? `Edit Product (${product.sku})` : 'New Product'}
          </h3>
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
            {errors.length > 0 && (
              <div className="alert alert-error" role="alert">
                <div className="alert-title">Could not save product</div>
                <ul>
                  {errors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="product-sku">
                SKU
              </label>
              <input
                id="product-sku"
                type="text"
                className="field-input mono"
                placeholder="e.g. SKU-017"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="product-name">
                Product Name
              </label>
              <input
                id="product-name"
                type="text"
                className="field-input"
                placeholder="e.g. Wireless Barcode Scanner"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="product-price">
                Price (IDR integer)
              </label>
              <input
                id="product-price"
                type="text"
                inputMode="numeric"
                className="field-input"
                placeholder="e.g. 250000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={saving}
                />
                <span>Active product</span>
              </label>
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
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
