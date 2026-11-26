export type ProductFilter = 'all' | 'active' | 'inactive' | 'low_stock';

export interface Product {
  id: number;
  sku: string;
  name: string;
  price: number;
  stock: number;
  is_active: boolean;
  created_at: string;
  last_movement_at: string | null;
}

export interface ProductListParams {
  search?: string;
  filter?: ProductFilter;
  page?: number;
  limit?: number;
}

export interface ProductListResponse {
  data: Product[];
  page: number;
  limit: number;
  total: number;
}

export interface ProductSummary {
  total_products: number;
  active_products: number;
  total_stock_value: number;
  low_stock_count: number;
}

export interface CreateProductPayload {
  sku: string;
  name: string;
  price: number;
  is_active: boolean;
}

export interface UpdateProductPayload {
  sku: string;
  name: string;
  price: number;
  is_active: boolean;
}

export type StockMovementType = 'in' | 'out';

export interface StockMovement {
  id: number;
  product_id: number;
  type: StockMovementType;
  qty: number;
  note: string | null;
  created_at: string;
}

export interface AdjustStockPayload {
  type: StockMovementType;
  qty: number;
  note: string;
}

export interface StockAdjustmentResponse {
  product: Product;
  movement: StockMovement;
}

export interface MovementsListResponse {
  data: StockMovement[];
}

export type OrderStatus = 'CREATED' | 'CANCELLED';

export interface SalesOrderItem {
  id: number;
  order_id: number;
  sku: string;
  product_name?: string;
  qty: number;
  unit_price: number;
}

export interface SalesOrder {
  id: number;
  customer: string;
  status: OrderStatus;
  total: number;
  created_at: string;
  cancelled_at: string | null;
  items: SalesOrderItem[];
}

export interface CreateOrderItemPayload {
  sku: string;
  qty: number;
}

export interface CreateOrderPayload {
  customer: string;
  items: CreateOrderItemPayload[];
}

export interface OrdersListResponse {
  data: SalesOrder[];
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DUPLICATE_SKU'
  | 'SKU_IN_USE'
  | 'PRODUCT_HAS_HISTORY'
  | 'INSUFFICIENT_STOCK'
  | 'ORDER_ALREADY_CANCELLED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface ApiErrorDetail {
  code: ApiErrorCode | string;
  message: string;
  sku?: string;
  available?: number;
  details?: string[];
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}
