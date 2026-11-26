import { useState } from 'react';
import { api, isApiClientError } from '../api/client';
import type { Product, ProductFilter } from '../api/types';
import { formatDateTime, formatIDR, formatRelativeTime } from '../utils/format';

interface ProductsTableProps {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  search: string;
  filter: ProductFilter;
  loading: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ProductFilter) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onAdjustStock: (product: Product) => void;
  onViewMovements: (product: Product) => void;
  onDeleted: () => void;
}

const FILTER_OPTIONS: Array<{ value: ProductFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'low_stock', label: 'Low stock (≤ 10)' },
];

export function ProductsTable({
  products,
  total,
  page,
  limit,
  search,
  filter,
  loading,
  error,
  onSearchChange,
  onFilterChange,
  onPageChange,
  onRetry,
  onAddProduct,
  onEditProduct,
  onAdjustStock,
  onViewMovements,
  onDeleted,
}: ProductsTableProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRow = Math.min(page * limit, total);
  const hasActiveFilters = search.trim().length > 0 || filter !== 'all';

  async function handleDelete(product: Product) {
    setDeleteError(null);
    const confirmed = window.confirm(
      `Delete ${product.sku} (${product.name})? Products with movement history cannot be deleted.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(product.id);
    try {
      await api.deleteProduct(product.id);
      onDeleted();
    } catch (err: unknown) {
      if (isApiClientError(err) && err.code === 'PRODUCT_HAS_HISTORY') {
        setDeleteError(
          `Cannot delete ${product.sku}: ${err.message} (409 ${err.code}).`,
        );
      } else if (isApiClientError(err)) {
        setDeleteError(`Failed to delete ${product.sku}: ${err.message}`);
      } else {
        setDeleteError(`Unexpected error deleting ${product.sku}.`);
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="panel" aria-label="Products catalog">
      <div className="panel-header">
        <h2>Products</h2>
        <button type="button" className="btn btn-primary" onClick={onAddProduct}>
          + New Product
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Search by SKU or product name..."
          aria-label="Search products"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        <div className="filter-group" role="group" aria-label="Product filter">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`filter-pill ${filter === opt.value ? 'active' : ''}`}
              onClick={() => onFilterChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {deleteError && (
        <div style={{ padding: '14px 18px 0' }}>
          <div className="alert alert-error" role="alert" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>{deleteError}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDeleteError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div className="state-box" role="alert">
          <h3>Could not load products</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="table-wrap" aria-busy="true" aria-label="Loading products">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th>Status</th>
                <th>Last Movement</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, idx) => (
                <tr key={idx}>
                  <td><span className="skeleton" style={{ width: 76 }} /></td>
                  <td><span className="skeleton" style={{ width: 220 }} /></td>
                  <td className="num"><span className="skeleton" style={{ width: 96 }} /></td>
                  <td className="num"><span className="skeleton" style={{ width: 44 }} /></td>
                  <td><span className="skeleton" style={{ width: 64 }} /></td>
                  <td><span className="skeleton" style={{ width: 70 }} /></td>
                  <td style={{ textAlign: 'right' }}><span className="skeleton" style={{ width: 170 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : products.length === 0 ? (
        <div className="state-box">
          <h3>No products found</h3>
          <p>
            {hasActiveFilters
              ? 'No products match your current search or filter.'
              : 'Your catalog is empty. Add your first product to get started.'}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onSearchChange('');
                onFilterChange('all');
              }}
            >
              Clear search &amp; filters
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onAddProduct}>
              + New Product
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th className="num">Price</th>
                  <th className="num">Stock</th>
                  <th>Status</th>
                  <th>Last Movement</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const isZero = product.stock === 0;
                  const isLow = product.stock > 0 && product.stock <= 10;

                  return (
                    <tr key={product.id}>
                      <td className="mono">{product.sku}</td>
                      <td>{product.name}</td>
                      <td className="num">{formatIDR(product.price)}</td>
                      <td className="num">
                        <span style={{ marginRight: 6, fontWeight: 600 }}>
                          {product.stock}
                        </span>
                        {isZero && <span className="badge badge-zero">Out</span>}
                        {isLow && <span className="badge badge-low">Low</span>}
                      </td>
                      <td>
                        <span
                          className={`badge ${product.is_active ? 'badge-active' : 'badge-inactive'}`}
                        >
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td title={formatDateTime(product.last_movement_at)}>
                        {formatRelativeTime(product.last_movement_at)}
                      </td>
                      <td>
                        <div className="actions-cell">
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => onAdjustStock(product)}
                          >
                            Adjust Stock
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onViewMovements(product)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => onEditProduct(product)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger-outline"
                            disabled={deletingId === product.id}
                            onClick={() => void handleDelete(product)}
                          >
                            {deletingId === product.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span>
              Showing {startRow}–{endRow} of {total} products
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
