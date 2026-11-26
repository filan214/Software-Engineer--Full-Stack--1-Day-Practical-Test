import { useState, type FormEvent } from 'react';
import type { SalesOrder } from '../api/types';
import { formatDateTime, formatIDR, formatRelativeTime } from '../utils/format';
import { parsePositiveInt } from '../utils/validation';

interface OrdersPanelProps {
  orders: SalesOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectOrder: (orderId: number) => void;
}

export function OrdersPanel({
  orders,
  loading,
  error,
  onRetry,
  onSelectOrder,
}: OrdersPanelProps) {
  const [lookupId, setLookupId] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  function handleLookup(e: FormEvent) {
    e.preventDefault();
    const id = parsePositiveInt(lookupId);
    if (id === null) {
      setLookupError('Enter a valid positive order ID.');
      return;
    }
    setLookupError(null);
    setLookupId('');
    onSelectOrder(id);
  }

  return (
    <section className="panel" aria-label="Sales orders">
      <div className="panel-header">
        <h2>Recent Orders</h2>
        <form
          onSubmit={handleLookup}
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        >
          <input
            type="text"
            inputMode="numeric"
            className="field-input"
            style={{ width: 120, padding: '5px 8px' }}
            placeholder="Order #ID"
            aria-label="Lookup order by ID"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
          />
          <button type="submit" className="btn btn-sm">
            Open
          </button>
        </form>
      </div>

      {lookupError && (
        <div style={{ padding: '12px 18px 0' }}>
          <div className="alert alert-error" role="alert" style={{ marginBottom: 0 }}>
            {lookupError}
          </div>
        </div>
      )}

      {error ? (
        <div className="state-box" role="alert">
          <h3>Could not load orders</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="state-box">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="state-box">
          <h3>No sales orders yet</h3>
          <p>Create your first sales order on the left to consume stock.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="mono">#{order.id}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{order.customer}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {order.items.length} item{order.items.length === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${order.status === 'CREATED' ? 'badge-active' : 'badge-inactive'}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatIDR(order.total)}
                  </td>
                  <td title={formatDateTime(order.created_at)}>
                    {formatRelativeTime(order.created_at)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onSelectOrder(order.id)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
