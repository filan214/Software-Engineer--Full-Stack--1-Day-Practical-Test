import type {
  AdjustStockPayload,
  ApiErrorDetail,
  ApiErrorEnvelope,
  CreateOrderPayload,
  CreateProductPayload,
  MovementsListResponse,
  OrdersListResponse,
  Product,
  ProductListParams,
  ProductListResponse,
  ProductSummary,
  SalesOrder,
  StockAdjustmentResponse,
  UpdateProductPayload,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly sku?: string;
  readonly available?: number;
  readonly details?: string[];

  constructor(status: number, detail: ApiErrorDetail) {
    super(detail.message || 'Request failed');
    this.name = 'ApiClientError';
    this.status = status;
    this.code = detail.code || 'UNKNOWN_ERROR';
    this.sku = detail.sku;
    this.available = detail.available;
    this.details = detail.details;
  }
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseErrorEnvelope(payload: unknown): ApiErrorDetail | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }
  const errObj = payload.error;
  const code = typeof errObj.code === 'string' ? errObj.code : 'UNKNOWN_ERROR';
  const message =
    typeof errObj.message === 'string' && errObj.message.length > 0
      ? errObj.message
      : code;
  const sku = typeof errObj.sku === 'string' ? errObj.sku : undefined;
  const available =
    typeof errObj.available === 'number' ? errObj.available : undefined;
  const details = Array.isArray(errObj.details)
    ? errObj.details.filter((item): item is string => typeof item === 'string')
    : undefined;

  const envelope: ApiErrorEnvelope = {
    error: { code, message, sku, available, details },
  };
  return envelope.error;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new ApiClientError(0, {
      code: 'NETWORK_ERROR',
      message: 'Unable to reach the StockFlow API server. Check that the backend is running.',
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  const isJson = contentType.includes('application/json');
  let body: unknown = null;

  if (isJson) {
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const parsed = parseErrorEnvelope(body);
    if (parsed) {
      throw new ApiClientError(response.status, parsed);
    }
    throw new ApiClientError(response.status, {
      code: 'UNKNOWN_ERROR',
      message: `Request failed with status ${response.status}`,
    });
  }

  return body as T;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value).length > 0) {
      sp.set(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  listProducts(
    params: ProductListParams = {},
    signal?: AbortSignal,
  ): Promise<ProductListResponse> {
    const query = buildQuery({
      search: params.search?.trim() || undefined,
      filter: params.filter && params.filter !== 'all' ? params.filter : undefined,
      page: params.page,
      limit: params.limit,
    });
    return request<ProductListResponse>(`/products${query}`, { signal });
  },

  getProductSummary(signal?: AbortSignal): Promise<ProductSummary> {
    return request<ProductSummary>('/products/summary', { signal });
  },

  createProduct(payload: CreateProductPayload): Promise<Product> {
    return request<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProduct(id: number, payload: UpdateProductPayload): Promise<Product> {
    return request<Product>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(id: number): Promise<void> {
    return request<void>(`/products/${id}`, {
      method: 'DELETE',
    });
  },

  adjustStock(
    id: number,
    payload: AdjustStockPayload,
  ): Promise<StockAdjustmentResponse> {
    return request<StockAdjustmentResponse>(`/products/${id}/stock`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listMovements(
    id: number,
    signal?: AbortSignal,
  ): Promise<MovementsListResponse> {
    return request<MovementsListResponse>(`/products/${id}/movements`, {
      signal,
    });
  },

  listOrders(limit = 30, signal?: AbortSignal): Promise<OrdersListResponse> {
    const query = buildQuery({ limit });
    return request<OrdersListResponse>(`/orders${query}`, { signal });
  },

  getOrder(id: number, signal?: AbortSignal): Promise<SalesOrder> {
    return request<SalesOrder>(`/orders/${id}`, { signal });
  },

  createOrder(payload: CreateOrderPayload): Promise<SalesOrder> {
    return request<SalesOrder>('/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  cancelOrder(id: number): Promise<SalesOrder> {
    return request<SalesOrder>(`/orders/${id}/cancel`, {
      method: 'POST',
    });
  },
};
