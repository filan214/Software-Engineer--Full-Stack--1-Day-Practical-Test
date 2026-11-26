import { useCallback, useEffect, useState } from 'react';
import { api, isApiClientError } from '../api/client';
import type { SalesOrder } from '../api/types';
import { formatDateTime, formatIDR } from '../utils/format';

interface OrderDetailModalProps {
  orderId: number;
  onClose: () => void;
  onOrderCancelled: () => void;
}

export function OrderDetailModal({
  orderId,
  onClose,
  onOrderCancelled,
}: OrderDetailModalProps) {
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  const loadOrder = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getOrder(orderId, signal);
        setOrder(data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(
          isApiClientError(err) ? err.message : 'Failed to load order details.',
        );
      } finally {
        setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadOrder(controller.signal);
    return () => controller.abort();
  }, [loadOrder]);

  async function handleConfirmCancel() {
    if (!order) return;
    setCancelError(null);
    setCancelling(true);
    try {
      const updated = await api.cancelOrder(order.id);
      setOrder(updated);
      setConfirmingCancel(false);
      setCancelSuccess(true);
      onOrderCancelled();
    } catch (err: unknown) {
      if (isApiClientError(err)) {
        setCancelError(`${err.message} (${err.status} ${err.code})`);
      } else {
        setCancelError('Unexpected error while cancelling order.');
      }
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
    >
      <div className="modal-card modal-card-lg">
        <div className="modal-header">
          <h3 id="order-detail-title">Order Detail #{orderId}</h3>
          <button
            type="button"
            className="btn btn-sm"
            disabled={cancelling}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="modal-body">
          {error ? (
            <div className="state-box" role="alert">
              <h3>Could not load order #{orderId}</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void loadOrder()}
              >
                Retry
              </button>
            </div>
          ) : loading || !order ? (
            <div className="state-box">Loading order details...</div>
          ) : (
            <>
              {cancelSuccess && (
                <div className="alert alert-success" role="status">
                  Order #{order.id} has been cancelled and all item stock has
                  been restored in the products catalog.
                </div>
              )}

              {cancelError && (
                <div className="alert alert-error" role="alert">
                  {cancelError}
                </div>
              )}

              <div className="meta-grid">
                <div>
                  <div className="meta-label">Customer</div>
                  <div className="meta-value">{order.customer}</div>
                </div>
                <div>
                  <div className="meta-label">Status</div>
                  <div className="meta-value">
                    <span
                      className={`badge ${order.status === 'CREATED' ? 'badge-active' : 'badge-inactive'}`}
                    >
                      {order.status}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="meta-label">Created At</div>
                  <div className="meta-value">
                    {formatDateTime(order.created_at)}
                  </div>
                </div>
                <div>
                  <div className="meta-label">
                    {order.cancelled_at ? 'Cancelled At' : 'Order Total'}
                  </div>
                  <div className="meta-value">
                    {order.cancelled_at
                      ? formatDateTime(order.cancelled_at)
                      : formatIDR(order.total)}
                  </div>
                </div>
              </div>

              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit Price</th>
                      <th className="num">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id}>
                        <td className="mono">{item.sku}</td>
                        <td>{item.product_name ?? '—'}</td>
                        <td className="num">{item.qty}</td>
                        <td className="num">{formatIDR(item.unit_price)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatIDR(item.qty * item.unit_price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="num" style={{ fontWeight: 700 }}>
                        Total (Server-Computed)
                      </td>
                      <td className="num" style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {formatIDR(order.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {order.status === 'CREATED' && confirmingCancel && (
                <div className="confirm-box" role="alertdialog" aria-label="Confirm cancel order">
                  <p>
                    Cancel Order #{order.id}? This will restore stock for all{' '}
                    {order.items.length} line item
                    {order.items.length === 1 ? '' : 's'} and record stock-in
                    movements. This action cannot be undone.
                  </p>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={cancelling}
                      onClick={() => void handleConfirmCancel()}
                    >
                      {cancelling ? 'Cancelling...' : 'Confirm Cancel Order'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={cancelling}
                      onClick={() => setConfirmingCancel(false)}
                    >
                      Keep Order
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {order && order.status === 'CREATED' && !confirmingCancel && (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel Order
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={cancelling}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
