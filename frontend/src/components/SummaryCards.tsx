import type { DailySalesReport, ProductSummary } from '../api/types';
import { formatIDR } from '../utils/format';

interface SummaryCardsProps {
  summary: ProductSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  dailySales: DailySalesReport | null;
  dailySalesLoading: boolean;
  dailySalesDate: string;
  onDailySalesDateChange: (date: string) => void;
}

export function SummaryCards({
  summary,
  loading,
  error,
  onRetry,
  dailySales,
  dailySalesLoading,
  dailySalesDate,
  onDailySalesDateChange,
}: SummaryCardsProps) {
  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>Failed to load inventory summary: {error}</span>
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="summary-grid" aria-label="Inventory summary">
      <div className="summary-card">
        <div className="summary-card-label">Total Products</div>
        <div className="summary-card-value">
          {loading || !summary ? <span className="skeleton" style={{ width: 64, height: 26 }} /> : summary.total_products}
        </div>
        <div className="summary-card-sub">Catalog SKUs</div>
      </div>

      <div className="summary-card">
        <div className="summary-card-label">Active Products</div>
        <div className="summary-card-value">
          {loading || !summary ? <span className="skeleton" style={{ width: 64, height: 26 }} /> : summary.active_products}
        </div>
        <div className="summary-card-sub">Available for sale</div>
      </div>

      <div className="summary-card">
        <div className="summary-card-label">Total Stock Value</div>
        <div className="summary-card-value">
          {loading || !summary ? (
            <span className="skeleton" style={{ width: 130, height: 26 }} />
          ) : (
            formatIDR(summary.total_stock_value)
          )}
        </div>
        <div className="summary-card-sub">Server-computed (IDR)</div>
      </div>

      <div className="summary-card">
        <div className="summary-card-label">Low-Stock Count</div>
        <div
          className={`summary-card-value ${summary && summary.low_stock_count > 0 ? 'warning' : ''}`}
        >
          {loading || !summary ? <span className="skeleton" style={{ width: 64, height: 26 }} /> : summary.low_stock_count}
        </div>
        <div className="summary-card-sub">Stock ≤ 10 units</div>
      </div>

      <div className="summary-card">
        <div className="summary-card-header">
          <span className="summary-card-label">Daily Sales</span>
          <input
            type="date"
            className="summary-date-input"
            aria-label="Daily sales date"
            value={dailySalesDate}
            onChange={(e) => {
              if (e.target.value) {
                onDailySalesDateChange(e.target.value);
              }
            }}
          />
        </div>
        <div className="summary-card-value">
          {dailySalesLoading || !dailySales ? (
            <span className="skeleton" style={{ width: 120, height: 26 }} />
          ) : (
            formatIDR(dailySales.total_revenue)
          )}
        </div>
        <div className="summary-card-sub">
          {dailySalesLoading || !dailySales
            ? 'Loading report...'
            : `${dailySales.orders_count} order${dailySales.orders_count === 1 ? '' : 's'} · ${dailySales.items_sold} item${dailySales.items_sold === 1 ? '' : 's'} sold`}
        </div>
      </div>
    </section>
  );
}
