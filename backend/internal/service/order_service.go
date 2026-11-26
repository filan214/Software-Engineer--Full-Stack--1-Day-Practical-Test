package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"stockflow/backend/internal/model"
)

type OrderService struct {
	pool *pgxpool.Pool
}

func NewOrderService(pool *pgxpool.Pool) *OrderService {
	return &OrderService{pool: pool}
}

type CreateOrderItemInput struct {
	SKU string
	Qty int
}

type CreateOrderInput struct {
	Customer string
	Items    []CreateOrderItemInput
}

type lockedProduct struct {
	ID    int
	SKU   string
	Name  string
	Price int
	Stock int
}

func (s *OrderService) Create(ctx context.Context, input CreateOrderInput) (model.SalesOrder, error) {
	customer := strings.TrimSpace(input.Customer)

	// 1. Validate everything before touching the database.
	var details []string
	if customer == "" {
		details = append(details, "customer is required")
	}
	if len(input.Items) == 0 {
		details = append(details, "items must contain at least one item")
	}

	normalizedItems := make([]CreateOrderItemInput, 0, len(input.Items))
	seenSKUs := make(map[string]struct{}, len(input.Items))
	duplicateSKUs := make(map[string]struct{})

	for i, item := range input.Items {
		sku := strings.TrimSpace(item.SKU)
		if sku == "" {
			details = append(details, fmt.Sprintf("items[%d].sku is required", i))
		} else {
			if _, exists := seenSKUs[sku]; exists {
				if _, alreadyReported := duplicateSKUs[sku]; !alreadyReported {
					duplicateSKUs[sku] = struct{}{}
					details = append(details, fmt.Sprintf("duplicate sku %q in order", sku))
				}
			} else {
				seenSKUs[sku] = struct{}{}
			}
		}
		if item.Qty <= 0 {
			details = append(details, fmt.Sprintf("items[%d].qty must be > 0", i))
		}
		normalizedItems = append(normalizedItems, CreateOrderItemInput{
			SKU: sku,
			Qty: item.Qty,
		})
	}

	if len(details) > 0 {
		return model.SalesOrder{}, ErrValidation(strings.Join(details, "; "), details...)
	}

	// Sort SKUs deterministically before acquiring FOR UPDATE locks to prevent deadlocks
	// when concurrent multi-item orders touch overlapping SKUs in opposite orders.
	sortedSKUs := make([]string, 0, len(seenSKUs))
	for sku := range seenSKUs {
		sortedSKUs = append(sortedSKUs, sku)
	}
	sort.Strings(sortedSKUs)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return model.SalesOrder{}, fmt.Errorf("begin order tx: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, sku, name, price, stock
		FROM products
		WHERE sku = ANY($1)
		ORDER BY sku ASC
		FOR UPDATE
	`, sortedSKUs)
	if err != nil {
		return model.SalesOrder{}, fmt.Errorf("lock products for order: %w", err)
	}

	productsBySKU := make(map[string]lockedProduct, len(sortedSKUs))
	for rows.Next() {
		var p lockedProduct
		if err := rows.Scan(&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock); err != nil {
			rows.Close()
			return model.SalesOrder{}, fmt.Errorf("scan locked product: %w", err)
		}
		productsBySKU[p.SKU] = p
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return model.SalesOrder{}, fmt.Errorf("iterate locked products: %w", err)
	}
	rows.Close()

	// Validate unknown SKUs before any writes occur.
	var unknownDetails []string
	for _, item := range normalizedItems {
		if _, ok := productsBySKU[item.SKU]; !ok {
			unknownDetails = append(unknownDetails, fmt.Sprintf("unknown sku %q", item.SKU))
		}
	}
	if len(unknownDetails) > 0 {
		return model.SalesOrder{}, ErrValidation(strings.Join(unknownDetails, "; "), unknownDetails...)
	}

	// Decrement stock for all items atomically in one transaction with guarded UPDATEs.
	var total64 int64
	for _, item := range normalizedItems {
		p := productsBySKU[item.SKU]
		tag, err := tx.Exec(ctx, `
			UPDATE products
			SET stock = stock - $1
			WHERE id = $2 AND stock >= $1
		`, item.Qty, p.ID)
		if err != nil {
			return model.SalesOrder{}, fmt.Errorf("decrement stock for %s: %w", p.SKU, err)
		}
		if tag.RowsAffected() == 0 {
			// Rollback happens via defer: zero stock or order rows will be persisted.
			return model.SalesOrder{}, ErrInsufficientStock(p.SKU, p.Stock)
		}

		total64 += int64(item.Qty) * int64(p.Price)
		if total64 > math.MaxInt32 {
			return model.SalesOrder{}, ErrValidation("order total exceeds maximum supported integer amount")
		}
	}

	var order model.SalesOrder
	err = tx.QueryRow(ctx, `
		INSERT INTO sales_orders (customer, status, total)
		VALUES ($1, 'CREATED', $2)
		RETURNING id, customer, status, total, created_at, cancelled_at
	`, customer, int(total64)).Scan(
		&order.ID, &order.Customer, &order.Status, &order.Total, &order.CreatedAt, &order.CancelledAt,
	)
	if err != nil {
		return model.SalesOrder{}, fmt.Errorf("insert sales order: %w", err)
	}

	note := fmt.Sprintf("Order #%d (%s)", order.ID, order.Customer)
	order.Items = make([]model.SalesOrderItem, 0, len(normalizedItems))

	for _, item := range normalizedItems {
		p := productsBySKU[item.SKU]
		var oi model.SalesOrderItem
		err = tx.QueryRow(ctx, `
			INSERT INTO sales_order_items (order_id, sku, qty, unit_price)
			VALUES ($1, $2, $3, $4)
			RETURNING id, order_id, sku, qty, unit_price
		`, order.ID, p.SKU, item.Qty, p.Price).Scan(
			&oi.ID, &oi.OrderID, &oi.SKU, &oi.Qty, &oi.UnitPrice,
		)
		if err != nil {
			return model.SalesOrder{}, fmt.Errorf("insert sales order item: %w", err)
		}
		oi.ProductName = p.Name
		order.Items = append(order.Items, oi)

		if _, err := tx.Exec(ctx, `
			INSERT INTO stock_movements (product_id, type, qty, note)
			VALUES ($1, 'out', $2, $3)
		`, p.ID, item.Qty, note); err != nil {
			return model.SalesOrder{}, fmt.Errorf("insert order stock movement: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return model.SalesOrder{}, fmt.Errorf("commit sales order: %w", err)
	}

	return order, nil
}

func (s *OrderService) Get(ctx context.Context, id int) (model.SalesOrder, error) {
	var order model.SalesOrder
	err := s.pool.QueryRow(ctx, `
		SELECT id, customer, status, total, created_at, cancelled_at
		FROM sales_orders
		WHERE id = $1
	`, id).Scan(
		&order.ID, &order.Customer, &order.Status, &order.Total, &order.CreatedAt, &order.CancelledAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.SalesOrder{}, ErrNotFound(fmt.Sprintf("Order #%d not found", id))
		}
		return model.SalesOrder{}, fmt.Errorf("get sales order: %w", err)
	}

	items, err := s.fetchOrderItems(ctx, s.pool, id)
	if err != nil {
		return model.SalesOrder{}, err
	}
	order.Items = items
	return order, nil
}

func (s *OrderService) List(ctx context.Context, limit int) ([]model.SalesOrder, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, customer, status, total, created_at, cancelled_at
		FROM sales_orders
		ORDER BY created_at DESC, id DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list sales orders: %w", err)
	}
	defer rows.Close()

	orders := make([]model.SalesOrder, 0)
	orderIDs := make([]int, 0)
	orderIndex := make(map[int]int)

	for rows.Next() {
		var o model.SalesOrder
		if err := rows.Scan(&o.ID, &o.Customer, &o.Status, &o.Total, &o.CreatedAt, &o.CancelledAt); err != nil {
			return nil, fmt.Errorf("scan sales order: %w", err)
		}
		o.Items = make([]model.SalesOrderItem, 0)
		orderIndex[o.ID] = len(orders)
		orders = append(orders, o)
		orderIDs = append(orderIDs, o.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sales orders: %w", err)
	}

	if len(orderIDs) == 0 {
		return orders, nil
	}

	itemRows, err := s.pool.Query(ctx, `
		SELECT i.id, i.order_id, i.sku, p.name, i.qty, i.unit_price
		FROM sales_order_items i
		JOIN products p ON p.sku = i.sku
		WHERE i.order_id = ANY($1)
		ORDER BY i.id ASC
	`, orderIDs)
	if err != nil {
		return nil, fmt.Errorf("list sales order items: %w", err)
	}
	defer itemRows.Close()

	for itemRows.Next() {
		var item model.SalesOrderItem
		if err := itemRows.Scan(&item.ID, &item.OrderID, &item.SKU, &item.ProductName, &item.Qty, &item.UnitPrice); err != nil {
			return nil, fmt.Errorf("scan sales order item: %w", err)
		}
		if idx, ok := orderIndex[item.OrderID]; ok {
			orders[idx].Items = append(orders[idx].Items, item)
		}
	}
	if err := itemRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sales order items: %w", err)
	}

	return orders, nil
}

func (s *OrderService) Cancel(ctx context.Context, id int) (model.SalesOrder, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return model.SalesOrder{}, fmt.Errorf("begin cancel order tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the order row so concurrent cancel requests cannot double-restore stock.
	var order model.SalesOrder
	err = tx.QueryRow(ctx, `
		SELECT id, customer, status, total, created_at, cancelled_at
		FROM sales_orders
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(
		&order.ID, &order.Customer, &order.Status, &order.Total, &order.CreatedAt, &order.CancelledAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.SalesOrder{}, ErrNotFound(fmt.Sprintf("Order #%d not found", id))
		}
		return model.SalesOrder{}, fmt.Errorf("lock sales order: %w", err)
	}

	if order.Status == "CANCELLED" {
		return model.SalesOrder{}, ErrOrderAlreadyCancelled(order.ID)
	}

	items, err := s.fetchOrderItemsOrderedBySKU(ctx, tx, order.ID)
	if err != nil {
		return model.SalesOrder{}, err
	}

	err = tx.QueryRow(ctx, `
		UPDATE sales_orders
		SET status = 'CANCELLED', cancelled_at = now()
		WHERE id = $1 AND status = 'CREATED'
		RETURNING status, cancelled_at
	`, order.ID).Scan(&order.Status, &order.CancelledAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.SalesOrder{}, ErrOrderAlreadyCancelled(order.ID)
		}
		return model.SalesOrder{}, fmt.Errorf("update order cancelled: %w", err)
	}

	note := fmt.Sprintf("Cancel order #%d", order.ID)
	for _, item := range items {
		var productID int
		if err := tx.QueryRow(ctx, `
			UPDATE products
			SET stock = stock + $1
			WHERE sku = $2
			RETURNING id
		`, item.Qty, item.SKU).Scan(&productID); err != nil {
			return model.SalesOrder{}, fmt.Errorf("restore stock for %s: %w", item.SKU, err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO stock_movements (product_id, type, qty, note)
			VALUES ($1, 'in', $2, $3)
		`, productID, item.Qty, note); err != nil {
			return model.SalesOrder{}, fmt.Errorf("insert cancel stock movement: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return model.SalesOrder{}, fmt.Errorf("commit cancel order: %w", err)
	}

	// Return items in their original insertion order for display consistency.
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	order.Items = items
	return order, nil
}

type queryable interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *OrderService) fetchOrderItems(ctx context.Context, q queryable, orderID int) ([]model.SalesOrderItem, error) {
	return s.queryOrderItems(ctx, q, orderID, "ORDER BY i.id ASC")
}

func (s *OrderService) fetchOrderItemsOrderedBySKU(ctx context.Context, q queryable, orderID int) ([]model.SalesOrderItem, error) {
	return s.queryOrderItems(ctx, q, orderID, "ORDER BY i.sku ASC")
}

func (s *OrderService) queryOrderItems(ctx context.Context, q queryable, orderID int, orderBy string) ([]model.SalesOrderItem, error) {
	rows, err := q.Query(ctx, fmt.Sprintf(`
		SELECT i.id, i.order_id, i.sku, p.name, i.qty, i.unit_price
		FROM sales_order_items i
		JOIN products p ON p.sku = i.sku
		WHERE i.order_id = $1
		%s
	`, orderBy), orderID)
	if err != nil {
		return nil, fmt.Errorf("fetch order items: %w", err)
	}
	defer rows.Close()

	items := make([]model.SalesOrderItem, 0)
	for rows.Next() {
		var item model.SalesOrderItem
		if err := rows.Scan(&item.ID, &item.OrderID, &item.SKU, &item.ProductName, &item.Qty, &item.UnitPrice); err != nil {
			return nil, fmt.Errorf("scan order item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate order items: %w", err)
	}
	return items, nil
}
