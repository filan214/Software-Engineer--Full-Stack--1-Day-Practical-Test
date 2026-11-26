import { useCallback, useEffect, useState } from 'react';
import { api, isApiClientError } from '../api/client';
import type { Product, StockMovement } from '../api/types';
import { formatDateTime, formatRelativeTime } from '../utils/format';

interface MovementsModalProps {
  product: Product;
  onClose: () => void;
}

export function MovementsModal({ product, onClose }: MovementsModalProps) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.listMovements(product.id, signal);
        setMovements(res.data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(
          isApiClientError(err) ? err.message : 'Failed to load stock history.',
        );
      } finally {
        setLoading(false);
      }
    },
    [product.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchMovements(controller.signal);
    return () => controller.abort();
  }, [fetchMovements]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movements-modal-title"
    >
      <div className="modal-card modal-card-lg">
        <div className="modal-header">
          <h3 id="movements-modal-title">
            Stock History — {product.sku} ({product.name})
          </h3>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {error ? (
            <div className="state-box" role="alert">
              <h3>Could not load movements</h3>
              <p>{error}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void fetchMovements()}
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="state-box">Loading stock movements...</div>
          ) : movements.length === 0 ? (
            <div className="state-box">
              <h3>No movement history yet</h3>
              <p>This product has not had any stock-in or stock-out transactions.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="num">Qty</th>
                    <th>Note</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((mv) => (
                    <tr key={mv.id}>
                      <td>
                        <span
                          className={`badge ${mv.type === 'in' ? 'badge-in' : 'badge-out'}`}
                        >
                          {mv.type === 'in' ? '+ IN' : '− OUT'}
                        </span>
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {mv.qty}
                      </td>
                      <td>{mv.note ?? '—'}</td>
                      <td title={formatDateTime(mv.created_at)}>
                        {formatRelativeTime(mv.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
