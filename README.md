# StockFlow — Inventory & Sales (Mini ERP Module)

Full-stack inventory and sales order management app built with **Go + PostgreSQL** (backend) and **React + TypeScript** (frontend).

## Repository Layout

```text
stockflow/
├── backend/            # Go API service (cmd/, internal/, migrations/)
├── frontend/           # React + TypeScript (Vite)
├── docker-compose.yml  # PostgreSQL with migrations + seed data
└── README.md
```

## Quick Start (Database — Part 0)

1. Start PostgreSQL with schema migrations and realistic seed data automatically applied:

```bash
docker compose up -d
```

2. Verify the database is ready and seeded:

```bash
docker compose exec postgres psql -U stockflow -d stockflow -c "SELECT count(*) AS products FROM products;"
```

To reset the database volume from scratch (re-running migrations and seeds):

```bash
docker compose down -v && docker compose up -d
```

> **Note:** Backend API (Part 1) and Frontend UI (Part 2) setup, `curl` examples, design decisions, and hours spent will be expanded as each part is completed.

## Initial Database Design Decisions

- **Integer money (IDR):** All prices (`products.price`, `sales_order_items.unit_price`, `sales_orders.total`) are stored as `INTEGER` with `>= 0` constraints — no floating-point currency math.
- **Derived `last_movement_at`:** Rather than duplicating `last_movement_at` on `products`, it is derived from `stock_movements` backed by a composite index `(product_id, created_at DESC, id DESC)`, keeping `stock_movements` as the single source of truth while keeping per-page queries fast.
- **Non-negative stock invariant:** `products.stock` has a DB-level `CHECK (stock >= 0)` constraint in addition to atomic guarded updates in transactions.
- **Immutable history:** Foreign keys on `stock_movements(product_id)` and `sales_order_items(sku)` prevent cascading deletes of historical records.
