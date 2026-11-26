package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"stockflow/backend/internal/model"
)

const LowStockThreshold = 10

type ProductService struct {
	pool *pgxpool.Pool
}

func NewProductService(pool *pgxpool.Pool) *ProductService {
	return &ProductService{pool: pool}
}

type ProductListParams struct {
	Search string
	Filter string // all | active | inactive | low_stock
	Page   int
	Limit  int
}

type CreateProductInput struct {
	SKU      string
	Name     string
	Price    *int
	IsActive *bool
}

type UpdateProductInput struct {
	SKU      string
	Name     string
	Price    *int
	IsActive *bool
}

type AdjustStockInput struct {
	Type string
	Qty  int
	Note string
}

func (s *ProductService) List(ctx context.Context, params ProductListParams) (model.ProductListResponse, error) {
	page := params.Page
	if page < 1 {
		page = 1
	}
	limit := params.Limit
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	var conditions []string
	var args []any

	search := strings.TrimSpace(params.Search)
	if search != "" {
		args = append(args, "%"+search+"%")
		idx := len(args)
		conditions = append(conditions, fmt.Sprintf("(p.sku ILIKE $%d OR p.name ILIKE $%d)", idx, idx))
	}

	switch strings.ToLower(strings.TrimSpace(params.Filter)) {
	case "", "all":
	case "active":
		conditions = append(conditions, "p.is_active = TRUE")
	case "inactive":
		conditions = append(conditions, "p.is_active = FALSE")
	case "low_stock":
		conditions = append(conditions, fmt.Sprintf("p.stock <= %d", LowStockThreshold))
	default:
		return model.ProductListResponse{}, ErrValidation("Invalid filter value; expected one of: all, active, inactive, low_stock")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM products p %s", whereClause)
	var total int
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return model.ProductListResponse{}, fmt.Errorf("count products: %w", err)
	}

	offset := (page - 1) * limit
	dataArgs := append(append([]any{}, args...), limit, offset)
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2

	dataQuery := fmt.Sprintf(`
		SELECT
			p.id, p.sku, p.name, p.price, p.stock, p.is_active, p.created_at,
			lm.created_at AS last_movement_at
		FROM products p
		LEFT JOIN LATERAL (
			SELECT m.created_at
			FROM stock_movements m
			WHERE m.product_id = p.id
			ORDER BY m.created_at DESC, m.id DESC
			LIMIT 1
		) lm ON TRUE
		%s
		ORDER BY p.id ASC
		LIMIT $%d OFFSET $%d
	`, whereClause, limitIdx, offsetIdx)

	rows, err := s.pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return model.ProductListResponse{}, fmt.Errorf("list products: %w", err)
	}
	defer rows.Close()

	products := make([]model.Product, 0)
	for rows.Next() {
		var p model.Product
		if err := rows.Scan(
			&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt, &p.LastMovementAt,
		); err != nil {
			return model.ProductListResponse{}, fmt.Errorf("scan product: %w", err)
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return model.ProductListResponse{}, fmt.Errorf("iterate products: %w", err)
	}

	return model.ProductListResponse{
		Data:  products,
		Page:  page,
		Limit: limit,
		Total: total,
	}, nil
}

func (s *ProductService) Summary(ctx context.Context) (model.ProductSummary, error) {
	var summary model.ProductSummary
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) AS total_products,
			COUNT(*) FILTER (WHERE is_active) AS active_products,
			COALESCE(SUM(price::bigint * stock::bigint), 0) AS total_stock_value,
			COUNT(*) FILTER (WHERE stock <= $1) AS low_stock_count
		FROM products
	`, LowStockThreshold).Scan(
		&summary.TotalProducts,
		&summary.ActiveProducts,
		&summary.TotalStockValue,
		&summary.LowStockCount,
	)
	if err != nil {
		return model.ProductSummary{}, fmt.Errorf("product summary: %w", err)
	}
	return summary, nil
}

func (s *ProductService) Create(ctx context.Context, input CreateProductInput) (model.Product, error) {
	sku := strings.TrimSpace(input.SKU)
	name := strings.TrimSpace(input.Name)

	var details []string
	if sku == "" {
		details = append(details, "sku is required")
	}
	if name == "" {
		details = append(details, "name is required")
	}
	if input.Price == nil {
		details = append(details, "price is required")
	} else if *input.Price < 0 {
		details = append(details, "price must be >= 0")
	}
	if len(details) > 0 {
		return model.Product{}, ErrValidation(strings.Join(details, "; "), details...)
	}

	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	var p model.Product
	err := s.pool.QueryRow(ctx, `
		INSERT INTO products (sku, name, price, is_active)
		VALUES ($1, $2, $3, $4)
		RETURNING id, sku, name, price, stock, is_active, created_at
	`, sku, name, *input.Price, isActive).Scan(
		&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt,
	)
	if err != nil {
		if isPGCode(err, "23505") {
			return model.Product{}, ErrDuplicateSKU(sku)
		}
		return model.Product{}, fmt.Errorf("create product: %w", err)
	}
	return p, nil
}

func (s *ProductService) Update(ctx context.Context, id int, input UpdateProductInput) (model.Product, error) {
	sku := strings.TrimSpace(input.SKU)
	name := strings.TrimSpace(input.Name)

	var details []string
	if sku == "" {
		details = append(details, "sku is required")
	}
	if name == "" {
		details = append(details, "name is required")
	}
	if input.Price == nil {
		details = append(details, "price is required")
	} else if *input.Price < 0 {
		details = append(details, "price must be >= 0")
	}
	if len(details) > 0 {
		return model.Product{}, ErrValidation(strings.Join(details, "; "), details...)
	}

	var p model.Product
	err := s.pool.QueryRow(ctx, `
		UPDATE products
		SET sku = $1,
			name = $2,
			price = $3,
			is_active = COALESCE($4, is_active)
		WHERE id = $5
		RETURNING
			id, sku, name, price, stock, is_active, created_at,
			(SELECT m.created_at FROM stock_movements m WHERE m.product_id = products.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
	`, sku, name, *input.Price, input.IsActive, id).Scan(
		&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt, &p.LastMovementAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.Product{}, ErrNotFound(fmt.Sprintf("Product #%d not found", id))
		}
		if isPGCode(err, "23505") {
			return model.Product{}, ErrDuplicateSKU(sku)
		}
		if isPGCode(err, "23503") {
			return model.Product{}, ErrSKUInUse(sku)
		}
		return model.Product{}, fmt.Errorf("update product: %w", err)
	}
	return p, nil
}

func (s *ProductService) Delete(ctx context.Context, id int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var existsID int
	if err := tx.QueryRow(ctx, `SELECT id FROM products WHERE id = $1 FOR UPDATE`, id).Scan(&existsID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(fmt.Sprintf("Product #%d not found", id))
		}
		return fmt.Errorf("lock product: %w", err)
	}

	var hasHistory bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id = $1)`, id).Scan(&hasHistory); err != nil {
		return fmt.Errorf("check movement history: %w", err)
	}
	if hasHistory {
		return ErrProductHasHistory()
	}

	if _, err := tx.Exec(ctx, `DELETE FROM products WHERE id = $1`, id); err != nil {
		if isPGCode(err, "23503") {
			return ErrProductHasHistory()
		}
		return fmt.Errorf("delete product: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit delete product: %w", err)
	}
	return nil
}

func (s *ProductService) AdjustStock(ctx context.Context, productID int, input AdjustStockInput) (model.StockAdjustmentResponse, error) {
	moveType := strings.ToLower(strings.TrimSpace(input.Type))
	var details []string
	if moveType != "in" && moveType != "out" {
		details = append(details, "type must be 'in' or 'out'")
	}
	if input.Qty <= 0 {
		details = append(details, "qty must be an integer > 0")
	}
	if len(details) > 0 {
		return model.StockAdjustmentResponse{}, ErrValidation(strings.Join(details, "; "), details...)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return model.StockAdjustmentResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var p model.Product
	if moveType == "out" {
		// Guard directly inside UPDATE so concurrent decrements can never drive stock negative.
		err = tx.QueryRow(ctx, `
			UPDATE products
			SET stock = stock - $1
			WHERE id = $2 AND stock >= $1
			RETURNING id, sku, name, price, stock, is_active, created_at
		`, input.Qty, productID).Scan(
			&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				var currentSKU string
				var available int
				lookupErr := tx.QueryRow(ctx, `SELECT sku, stock FROM products WHERE id = $1`, productID).Scan(&currentSKU, &available)
				if errors.Is(lookupErr, pgx.ErrNoRows) {
					return model.StockAdjustmentResponse{}, ErrNotFound(fmt.Sprintf("Product #%d not found", productID))
				}
				if lookupErr != nil {
					return model.StockAdjustmentResponse{}, fmt.Errorf("lookup product stock: %w", lookupErr)
				}
				return model.StockAdjustmentResponse{}, ErrInsufficientStock(currentSKU, available)
			}
			return model.StockAdjustmentResponse{}, fmt.Errorf("decrement product stock: %w", err)
		}
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE products
			SET stock = stock + $1
			WHERE id = $2
			RETURNING id, sku, name, price, stock, is_active, created_at
		`, input.Qty, productID).Scan(
			&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return model.StockAdjustmentResponse{}, ErrNotFound(fmt.Sprintf("Product #%d not found", productID))
			}
			return model.StockAdjustmentResponse{}, fmt.Errorf("increment product stock: %w", err)
		}
	}

	var notePtr *string
	if trimmedNote := strings.TrimSpace(input.Note); trimmedNote != "" {
		notePtr = &trimmedNote
	}

	var mv model.StockMovement
	err = tx.QueryRow(ctx, `
		INSERT INTO stock_movements (product_id, type, qty, note)
		VALUES ($1, $2, $3, $4)
		RETURNING id, product_id, type, qty, note, created_at
	`, productID, moveType, input.Qty, notePtr).Scan(
		&mv.ID, &mv.ProductID, &mv.Type, &mv.Qty, &mv.Note, &mv.CreatedAt,
	)
	if err != nil {
		return model.StockAdjustmentResponse{}, fmt.Errorf("insert stock movement: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return model.StockAdjustmentResponse{}, fmt.Errorf("commit adjust stock: %w", err)
	}

	ts := mv.CreatedAt
	p.LastMovementAt = &ts

	return model.StockAdjustmentResponse{
		Product:  p,
		Movement: mv,
	}, nil
}

func (s *ProductService) ListMovements(ctx context.Context, productID int) ([]model.StockMovement, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id = $1)`, productID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check product exists: %w", err)
	}
	if !exists {
		return nil, ErrNotFound(fmt.Sprintf("Product #%d not found", productID))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, product_id, type, qty, note, created_at
		FROM stock_movements
		WHERE product_id = $1
		ORDER BY created_at DESC, id DESC
	`, productID)
	if err != nil {
		return nil, fmt.Errorf("list movements: %w", err)
	}
	defer rows.Close()

	movements := make([]model.StockMovement, 0)
	for rows.Next() {
		var m model.StockMovement
		if err := rows.Scan(&m.ID, &m.ProductID, &m.Type, &m.Qty, &m.Note, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan movement: %w", err)
		}
		movements = append(movements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate movements: %w", err)
	}
	return movements, nil
}

func isPGCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
