import { useCallback, useEffect, useState } from 'react';
import { api, isApiClientError } from './api/client';
import type {
  DailySalesReport,
  Product,
  ProductFilter,
  ProductSummary,
  SalesOrder,
} from './api/types';
import { AdjustStockModal } from './components/AdjustStockModal';
import { CreateOrderPanel } from './components/CreateOrderPanel';
import { MovementsModal } from './components/MovementsModal';
import { OrderDetailModal } from './components/OrderDetailModal';
import { OrdersPanel } from './components/OrdersPanel';
import { ProductFormModal } from './components/ProductFormModal';
import { ProductsTable } from './components/ProductsTable';
import { SummaryCards } from './components/SummaryCards';
import { useDebounce } from './hooks/useDebounce';
import { formatDateInput } from './utils/format';

type ActiveTab = 'products' | 'orders';
const PAGE_LIMIT = 10;

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('products');
  const [refreshToken, setRefreshToken] = useState(0);

  // Products table state
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [page, setPage] = useState(1);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  // Catalog for order creation selector (up to 100 SKUs)
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);

  // Summary cards & daily sales report state
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [dailySalesDate, setDailySalesDate] = useState<string>(() =>
    formatDateInput(),
  );
  const [dailySales, setDailySales] = useState<DailySalesReport | null>(null);
  const [dailySalesLoading, setDailySalesLoading] = useState(true);

  // Orders state
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // Modals
  const [productModalState, setProductModalState] = useState<{
    open: boolean;
    product: Product | null;
  }>({ open: false, product: null });
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [movementsTarget, setMovementsTarget] = useState<Product | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const triggerRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter]);

  // Fetch paginated/filtered products
  const loadProducts = useCallback(
    async (signal?: AbortSignal) => {
      setProductsLoading(true);
      setProductsError(null);
      try {
        const res = await api.listProducts(
          {
            search: debouncedSearch,
            filter,
            page,
            limit: PAGE_LIMIT,
          },
          signal,
        );
        setProducts(res.data);
        setProductsTotal(res.total);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setProductsError(
          isApiClientError(err) ? err.message : 'Failed to load products.',
        );
      } finally {
        setProductsLoading(false);
      }
    },
    [debouncedSearch, filter, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProducts(controller.signal);
    return () => controller.abort();
  }, [loadProducts, refreshToken]);

  // Fetch server-wide summary cards
  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await api.getProductSummary(signal);
      setSummary(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setSummaryError(
        isApiClientError(err) ? err.message : 'Failed to load summary.',
      );
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary, refreshToken]);

  // Fetch daily sales report for selected date
  useEffect(() => {
    const controller = new AbortController();
    setDailySalesLoading(true);
    api
      .getDailySales(dailySalesDate, controller.signal)
      .then((report) => setDailySales(report))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setDailySales(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDailySalesLoading(false);
        }
      });
    return () => controller.abort();
  }, [dailySalesDate, refreshToken]);

  // Fetch full catalog for the Create Order dropdown
  useEffect(() => {
    const controller = new AbortController();
    api
      .listProducts({ page: 1, limit: 100 }, controller.signal)
      .then((res) => setCatalogProducts(res.data))
      .catch(() => {
        // Non-blocking: main table handles surfacing API errors
      });
    return () => controller.abort();
  }, [refreshToken]);

  // Fetch recent orders
  const loadOrders = useCallback(async (signal?: AbortSignal) => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await api.listOrders(30, signal);
      setOrders(res.data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setOrdersError(
        isApiClientError(err) ? err.message : 'Failed to load orders.',
      );
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOrders(controller.signal);
    return () => controller.abort();
  }, [loadOrders, refreshToken]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1>StockFlow</h1>
          <p>Warehouse Inventory &amp; Sales Orders (Mini ERP)</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setActiveTab('orders')}
          >
            + Create Sales Order
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setProductModalState({ open: true, product: null })}
          >
            + New Product
          </button>
        </div>
      </header>

      <SummaryCards
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        onRetry={() => void loadSummary()}
        dailySales={dailySales}
        dailySalesLoading={dailySalesLoading}
        dailySalesDate={dailySalesDate}
        onDailySalesDateChange={setDailySalesDate}
      />

      <nav className="nav-tabs" aria-label="Main sections">
        <button
          type="button"
          className={`nav-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Products &amp; Stock
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('orders')}
        >
          Sales Orders ({orders.length})
        </button>
      </nav>

      <main>
        {activeTab === 'products' ? (
          <ProductsTable
            products={products}
            total={productsTotal}
            page={page}
            limit={PAGE_LIMIT}
            search={search}
            filter={filter}
            loading={productsLoading}
            error={productsError}
            onSearchChange={setSearch}
            onFilterChange={setFilter}
            onPageChange={setPage}
            onRetry={() => void loadProducts()}
            onAddProduct={() =>
              setProductModalState({ open: true, product: null })
            }
            onEditProduct={(product) =>
              setProductModalState({ open: true, product })
            }
            onAdjustStock={(product) => setAdjustTarget(product)}
            onViewMovements={(product) => setMovementsTarget(product)}
            onDeleted={triggerRefresh}
          />
        ) : (
          <div className="orders-layout">
            <CreateOrderPanel
              products={catalogProducts}
              onOrderCreated={() => triggerRefresh()}
              onViewOrder={(orderId) => setSelectedOrderId(orderId)}
            />
            <OrdersPanel
              orders={orders}
              loading={ordersLoading}
              error={ordersError}
              onRetry={() => void loadOrders()}
              onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
            />
          </div>
        )}
      </main>

      {productModalState.open && (
        <ProductFormModal
          product={productModalState.product}
          onClose={() => setProductModalState({ open: false, product: null })}
          onSaved={() => {
            setProductModalState({ open: false, product: null });
            triggerRefresh();
          }}
        />
      )}

      {adjustTarget && (
        <AdjustStockModal
          product={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onAdjusted={() => {
            setAdjustTarget(null);
            triggerRefresh();
          }}
        />
      )}

      {movementsTarget && (
        <MovementsModal
          product={movementsTarget}
          onClose={() => setMovementsTarget(null)}
        />
      )}

      {selectedOrderId !== null && (
        <OrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onOrderCancelled={triggerRefresh}
        />
      )}
    </div>
  );
}

export default App;
