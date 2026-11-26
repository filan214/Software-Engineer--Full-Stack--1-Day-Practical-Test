import type { ProductSummary } from '../api/types';
import { formatIDR } from '../utils/format';

interface SummaryCardsProps {
  summary: ProductSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function SummaryCards({
  summary,
  loading,
  error,
  onRetry,
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
            <span className="skeleton" style={{ width: 140, height: 26 }} />
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
    </section>
  );
}
