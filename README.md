# StockFlow — Inventory & Sales (Mini ERP Module)

Full-stack warehouse inventory and sales order application built with **Go + PostgreSQL** (backend) and **React + TypeScript + Vite** (frontend).

---

## Repository Layout

```text
stockflow/
├── backend/
│   ├── cmd/api/            # HTTP server entrypoint (graceful shutdown)
│   ├── internal/
│   │   ├── config/         # Env & .env loader
│   │   ├── db/             # pgxpool PostgreSQL setup
│   │   ├── handler/        # net/http routes, middleware, JSON error envelope, integration tests
│   │   ├── model/          # Domain & response structs
│   │   └── service/        # Transactional product, stock, and order business logic
│   └── migrations/
│       ├── 001_init.sql    # Tables, constraints, and indexes
│       └── 002_seed.sql    # 16 realistic products + 3 reconciled sample orders
├── frontend/
│   └── src/
│       ├── api/            # Shared strict TS types (types.ts) & single fetch client (client.ts)
│       ├── components/     # Products table, summary cards, modals, order creation & detail
│       ├── hooks/          # useDebounce
│       └── utils/          # IDR/relative-time formatting, validators, Vitest unit tests
├── docker-compose.yml      # PostgreSQL 16 with automatic migrations + seed data
├── .env.example            # Environment variable template
└── README.md
```

---

## Quick Start (Runnable in ≤ 5 Minutes)

### Prerequisites
- **Docker** (with Compose v2)
- **Go 1.22+**
- **Node.js 20+** (with npm)

### 1. Start PostgreSQL (migrations + seed applied automatically)

```bash
cd stockflow
docker compose up -d --wait
```

> **Port 5432 already in use?** Copy `.env.example` to `.env` and set `POSTGRES_PORT=5433` and `DATABASE_URL=postgres://stockflow:stockflow@localhost:5433/stockflow?sslmode=disable`. Both Docker Compose and the Go backend automatically read `.env`.

To reset the database from scratch (re-running `001_init.sql` and `002_seed.sql`):

```bash
docker compose down -v && docker compose up -d --wait
```

### 2. Start the Go Backend API (Terminal 1)

```bash
cd stockflow/backend
go run ./cmd/api
```

The API listens on `http://localhost:8080` (`GET /api/health` returns `{"status":"ok"}`).

### 3. Start the React + TypeScript Frontend (Terminal 2)

```bash
cd stockflow/frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. Vite proxies `/api/*` requests to `http://localhost:8080` (configurable via `VITE_API_PROXY_TARGET`), and the backend also includes CORS middleware for `http://localhost:5173`.

---

## Running Tests

### Backend (Integration & Concurrency Tests)
Tests automatically create and reset an isolated `stockflow_test` database using `backend/migrations/001_init.sql` so your seeded dev database is never overwritten:

```bash
cd stockflow/backend
go test -v -count=1 ./...
```

With the Go race detector (requires CGO / `gcc` on Linux/macOS/Windows-MinGW):

```bash
go test -race -v -count=1 ./...
```

What is tested in `backend/internal/handler/api_test.go`:
- Product CRUD, case-insensitive search, filters, summary metrics, float/negative price rejection, and `409 PRODUCT_HAS_HISTORY` on delete
- Stock adjustments (`in`/`out`), newest-first movement history, and `409 INSUFFICIENT_STOCK` (including `available: 0`) with **zero writes**
- Order pre-write validation (`400` on empty customer, empty items, `qty <= 0`, duplicate SKUs, unknown SKU)
- Server-side pricing (ignores client-supplied `unit_price`/`total`) and full multi-item atomic rollback on `409`
- Order cancellation restoring stock & blocking double-cancel (`409`)
- **Concurrency tests:**
  - 20 concurrent orders competing for 5 units of the same SKU → exactly 5 succeed (`201`), 15 conflict (`409`), final stock `0`, ledger reconciled
  - 20 concurrent overlapping multi-SKU orders in opposite SKU orders → 0 deadlocks, exact reconciliation
  - 10 concurrent cancellations of the same order → exactly 1 succeeds (`200`), 9 conflict (`409`), stock restored once

### Frontend (Typecheck, Vitest Unit Tests & Build)

```bash
cd stockflow/frontend
npm run typecheck
npm test
npm run build
```

---

## API Examples (`curl`)

### Health & Products

```bash
# Health check
curl http://localhost:8080/api/health

# List products (search, filter: all|active|inactive|low_stock, pagination)
curl "http://localhost:8080/api/products?search=scanner&page=1&limit=10"
curl "http://localhost:8080/api/products?filter=low_stock&page=1&limit=10"

# Server-derived summary cards data
curl http://localhost:8080/api/products/summary

# Create product (201)
curl -X POST http://localhost:8080/api/products \
  -H "Content-Type: application/json" \
  -d '{"sku":"SKU-099","name":"Handheld Barcode Terminal","price":2450000,"is_active":true}'

# Update product (200; 404 when missing)
curl -X PUT http://localhost:8080/api/products/1 \
  -H "Content-Type: application/json" \
  -d '{"sku":"SKU-001","name":"Mechanical Barcode Scanner 2D Pro","price":890000,"is_active":true}'

# Delete product without history -> 204 (e.g. SKU-016)
curl -i -X DELETE http://localhost:8080/api/products/16

# Delete product with movement history -> 409 {"error":{"code":"PRODUCT_HAS_HISTORY",...}}
curl -i -X DELETE http://localhost:8080/api/products/1
```

### Stock Adjustments & Movements

```bash
# Stock in (200; updates stock + inserts movement in one transaction)
curl -X POST http://localhost:8080/api/products/8/stock \
  -H "Content-Type: application/json" \
  -d '{"type":"in","qty":5,"note":"Emergency restock PO-2001"}'

# Stock out overdraw -> 409 {"error":{"code":"INSUFFICIENT_STOCK","sku":"SKU-008","available":...}}
curl -i -X POST http://localhost:8080/api/products/8/stock \
  -H "Content-Type: application/json" \
  -d '{"type":"out","qty":999,"note":"Overdraw test"}'

# Product movement history (newest first)
curl http://localhost:8080/api/products/1/movements
```

### Sales Orders & Cancellation

```bash
# Create order (201; unit_price & total computed strictly server-side)
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"PT Karya Mandiri","items":[{"sku":"SKU-001","qty":2},{"sku":"SKU-003","qty":5}]}'

# Create order with insufficient stock on 2nd item -> 409 (rolls back entire tx; zero stock changed)
curl -i -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"PT Overdraw","items":[{"sku":"SKU-001","qty":1},{"sku":"SKU-008","qty":999}]}'

# Get order detail
curl http://localhost:8080/api/orders/1

# List recent orders
curl "http://localhost:8080/api/orders?limit=20"

# Cancel order (200 restores stock; repeating returns 409 ORDER_ALREADY_CANCELLED)
curl -X POST http://localhost:8080/api/orders/1/cancel
```

---

## Design Decisions

1. **Deriving `last_movement_at` vs. storing it on `products`:**
   - Chosen: **derived from `stock_movements`** via a `LEFT JOIN LATERAL (... ORDER BY created_at DESC, id DESC LIMIT 1)` backed by a composite index `idx_stock_movements_product_created (product_id, created_at DESC, id DESC)`.
   - Why: `stock_movements` remains the single source of truth — `last_movement_at` can never drift out of sync (including with seeded data or direct SQL), and the same composite index accelerates `GET /api/products/{id}/movements`.
2. **Concurrency safety & deadlock avoidance on orders:**
   - Every order runs inside a single PostgreSQL transaction. Requested SKUs are sorted alphabetically and locked via `SELECT ... WHERE sku = ANY($1) ORDER BY sku ASC FOR UPDATE`, eliminating lock-order inversion deadlocks when concurrent multi-item orders touch overlapping SKUs in opposite order.
   - Each stock deduction uses a guarded `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1` (backed by DB-level `CHECK (stock >= 0)`). Any failure rolls back the entire transaction so no partial deductions or orphan rows can ever persist.
   - Order cancellation locks the `sales_orders` row with `FOR UPDATE` before checking `status = 'CREATED'`, preventing concurrent cancels from restoring stock twice.
3. **Integer money (IDR) & server-side pricing:**
   - Prices and totals are stored as PostgreSQL `INTEGER` (with `BIGINT` aggregation for `total_stock_value`), avoiding floating-point drift. Go's `int` JSON decoding rejects decimal prices (`12.5`) with `400`.
   - `POST /api/orders` ignores any client-supplied prices and computes `unit_price` and `total` strictly from `products`.
4. **Uniform JSON error envelope & zero-value fidelity:**
   - All API errors return `{"error":{"code","message","sku?","available?","details?"}}`. `available` is modeled as `*int` in Go so `available: 0` is explicitly serialized rather than dropped by `omitempty`, allowing the frontend to always display the exact server-side available count.
5. **Frontend architecture & dev proxy:**
   - All domain types live in `frontend/src/api/types.ts` (strict TypeScript, zero `any`).
   - `frontend/src/api/client.ts` owns all `fetch()` calls, URL construction, and `ApiClientError` envelope parsing; UI components never construct URLs or call `fetch` directly.
   - Configured Vite's `/api` dev proxy (`vite.config.ts`) plus backend CORS middleware (`middleware.go`) so dev works smoothly both via proxy and direct calls.
   - Summary cards read from `GET /api/products/summary` instead of slicing the current paginated page, keeping totals accurate across pagination and filters.

---

## What I Would Improve With More Time

- **Idempotency keys (`Idempotency-Key` header on `POST /api/orders`)** stored in a dedicated table with request hash validation so network retries never create duplicate orders.
- **Full-stack `docker-compose.yml`** with multi-stage Dockerfiles for the Go API and static Nginx-served React frontend so a single `docker compose up` boots the entire stack.
- **Daily sales reporting (`GET /api/reports/daily-sales?date=`)** with timezone-aware business-day bucketing and a dedicated dashboard card.
- **Versioned SQL migrations** (e.g., `golang-migrate` or `goose`) applied on API startup instead of relying solely on Postgres's first-boot `/docker-entrypoint-initdb.d`.
- **Authentication, RBAC & audit actors** (`created_by` on movements and orders) so supervisors can trace who performed each adjustment or cancellation.
- **Playwright end-to-end tests** automating the full browser flows (search, `409` modal feedback, order creation, and cancel stock restoration).

---

## Honest Hours Spent

| Phase | Scope | Time |
|---|---|---|
| **Part 0** | Repo layout, Docker Compose, Postgres schema & reconciled seed data | ~0.5 hrs |
| **Part 1** | Go API (products, stock movements, atomic orders, cancel) + 9 integration & concurrency tests | ~1.5 hrs |
| **Part 2** | React + strict TypeScript UI, single API client, all 5 screens/flows + 13 Vitest tests | ~1.5 hrs |
| **Part 3** | End-to-end verification, `README.md` documentation, `curl` examples & review | ~0.5 hrs |
| **Total** | | **~4.0 hrs** |
