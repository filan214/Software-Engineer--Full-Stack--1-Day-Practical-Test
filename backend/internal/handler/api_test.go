package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"stockflow/backend/internal/config"
	"stockflow/backend/internal/db"
	"stockflow/backend/internal/handler"
	"stockflow/backend/internal/model"
)

type apiErrorBody struct {
	Error struct {
		Code      string   `json:"code"`
		Message   string   `json:"message"`
		SKU       string   `json:"sku"`
		Available *int     `json:"available"`
		Details   []string `json:"details"`
	} `json:"error"`
}

func setupTestEnv(t *testing.T) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	ctx := context.Background()

	testDBURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDBURL == "" {
		// Load ../.env or ../../.env for local dev convenience
		origWD, _ := os.Getwd()
		_ = os.Chdir(filepath.Join(origWD, "..", ".."))
		cfg := config.Load()
		_ = os.Chdir(origWD)

		u, err := url.Parse(cfg.DatabaseURL)
		if err != nil {
			t.Fatalf("parse DATABASE_URL: %v", err)
		}

		// Ensure dedicated stockflow_test database exists so tests never touch dev seed data.
		adminURL := *u
		adminURL.Path = "/postgres"
		adminConn, err := pgx.Connect(ctx, adminURL.String())
		if err != nil {
			t.Fatalf("connect admin postgres (%s): %v", adminURL.String(), err)
		}
		var exists bool
		if err := adminConn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'stockflow_test')`).Scan(&exists); err != nil {
			adminConn.Close(ctx)
			t.Fatalf("check stockflow_test database: %v", err)
		}
		if !exists {
			if _, err := adminConn.Exec(ctx, `CREATE DATABASE stockflow_test`); err != nil {
				adminConn.Close(ctx)
				t.Fatalf("create stockflow_test database: %v", err)
			}
		}
		adminConn.Close(ctx)

		testURL := *u
		testURL.Path = "/stockflow_test"
		testDBURL = testURL.String()
	}

	pool, err := db.NewPool(ctx, testDBURL)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(pool.Close)

	migrationPath := filepath.Join("..", "..", "migrations", "001_init.sql")
	migrationSQL, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration %s: %v", migrationPath, err)
	}

	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset test schema: %v", err)
	}
	if _, err := pool.Exec(ctx, string(migrationSQL)); err != nil {
		t.Fatalf("apply migration: %v", err)
	}

	return pool, handler.NewRouter(pool, "*")
}

func doJSON(t *testing.T, router http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		switch v := body.(type) {
		case string:
			buf.WriteString(v)
		default:
			if err := json.NewEncoder(&buf).Encode(body); err != nil {
				t.Fatalf("marshal request body: %v", err)
			}
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func createProductHelper(t *testing.T, router http.Handler, sku, name string, price int, isActive bool) model.Product {
	t.Helper()
	rec := doJSON(t, router, http.MethodPost, "/api/products", map[string]any{
		"sku":       sku,
		"name":      name,
		"price":     price,
		"is_active": isActive,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create product %s failed: status=%d body=%s", sku, rec.Code, rec.Body.String())
	}
	var p model.Product
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode product: %v", err)
	}
	return p
}

func adjustStockHelper(t *testing.T, router http.Handler, productID int, moveType string, qty int, note string) *httptest.ResponseRecorder {
	t.Helper()
	return doJSON(t, router, http.MethodPost, fmt.Sprintf("/api/products/%d/stock", productID), map[string]any{
		"type": moveType,
		"qty":  qty,
		"note": note,
	})
}

func TestProductCRUDAndDeleteGuard(t *testing.T) {
	_, router := setupTestEnv(t)

	// Create valid products
	p1 := createProductHelper(t, router, "SKU-A1", "Barcode Scanner", 850000, true)
	p2 := createProductHelper(t, router, "SKU-B2", "Old Label Printer", 450000, false)

	// Duplicate SKU -> 409
	dupRec := doJSON(t, router, http.MethodPost, "/api/products", map[string]any{
		"sku": "SKU-A1", "name": "Dup", "price": 1000,
	})
	if dupRec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate sku, got %d: %s", dupRec.Code, dupRec.Body.String())
	}

	// Negative price -> 400
	negRec := doJSON(t, router, http.MethodPost, "/api/products", map[string]any{
		"sku": "SKU-NEG", "name": "Bad Price", "price": -50,
	})
	if negRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative price, got %d: %s", negRec.Code, negRec.Body.String())
	}

	// Float price -> 400 (no float money)
	floatRec := doJSON(t, router, http.MethodPost, "/api/products", `{"sku":"SKU-FLT","name":"Float","price":12.5}`)
	if floatRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for float price, got %d: %s", floatRec.Code, floatRec.Body.String())
	}

	// Add stock movement to p1 so p1 has movement history and stock > 10
	adjRec := adjustStockHelper(t, router, p1.ID, "in", 15, "Initial receipt")
	if adjRec.Code != http.StatusOK {
		t.Fatalf("adjust stock failed: %d %s", adjRec.Code, adjRec.Body.String())
	}

	// GET /api/products search (case-insensitive) + derived last_movement_at
	listRec := doJSON(t, router, http.MethodGet, "/api/products?search=scanner&page=1&limit=10", nil)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list products failed: %d %s", listRec.Code, listRec.Body.String())
	}
	var listRes model.ProductListResponse
	if err := json.Unmarshal(listRec.Body.Bytes(), &listRes); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if listRes.Total != 1 || len(listRes.Data) != 1 || listRes.Data[0].SKU != "SKU-A1" {
		t.Fatalf("unexpected search result: %+v", listRes)
	}
	if listRes.Data[0].LastMovementAt == nil {
		t.Fatalf("expected non-null last_movement_at for product with movement")
	}

	// Filter low_stock (p2 has stock 0, p1 has stock 15)
	lowRec := doJSON(t, router, http.MethodGet, "/api/products?filter=low_stock", nil)
	var lowRes model.ProductListResponse
	_ = json.Unmarshal(lowRec.Body.Bytes(), &lowRes)
	if lowRes.Total != 1 || lowRes.Data[0].SKU != "SKU-B2" || lowRes.Data[0].LastMovementAt != nil {
		t.Fatalf("unexpected low_stock result: %+v", lowRes)
	}

	// Summary endpoint
	sumRec := doJSON(t, router, http.MethodGet, "/api/products/summary", nil)
	if sumRec.Code != http.StatusOK {
		t.Fatalf("summary failed: %d %s", sumRec.Code, sumRec.Body.String())
	}
	var summary model.ProductSummary
	_ = json.Unmarshal(sumRec.Body.Bytes(), &summary)
	if summary.TotalProducts != 2 || summary.ActiveProducts != 1 || summary.TotalStockValue != 15*850000 || summary.LowStockCount != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}

	// PUT missing -> 404
	missPut := doJSON(t, router, http.MethodPut, "/api/products/99999", map[string]any{
		"sku": "SKU-X", "name": "X", "price": 100,
	})
	if missPut.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on missing PUT, got %d", missPut.Code)
	}

	// DELETE product WITH history -> 409 PRODUCT_HAS_HISTORY
	delHist := doJSON(t, router, http.MethodDelete, fmt.Sprintf("/api/products/%d", p1.ID), nil)
	if delHist.Code != http.StatusConflict {
		t.Fatalf("expected 409 for deleting product with history, got %d: %s", delHist.Code, delHist.Body.String())
	}
	var errBody apiErrorBody
	_ = json.Unmarshal(delHist.Body.Bytes(), &errBody)
	if errBody.Error.Code != "PRODUCT_HAS_HISTORY" {
		t.Fatalf("expected PRODUCT_HAS_HISTORY, got %q", errBody.Error.Code)
	}

	// DELETE product WITHOUT history -> 204
	delClean := doJSON(t, router, http.MethodDelete, fmt.Sprintf("/api/products/%d", p2.ID), nil)
	if delClean.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for deleting product without history, got %d: %s", delClean.Code, delClean.Body.String())
	}
}

func TestStockAdjustmentHappyPathAndInsufficientStock(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p := createProductHelper(t, router, "SKU-STK", "Thermal Paper", 50000, true)

	// Overdraw when stock is 0 -> 409 INSUFFICIENT_STOCK with available: 0 explicitly serialized!
	zeroOverdraw := adjustStockHelper(t, router, p.ID, "out", 1, "Should fail")
	if zeroOverdraw.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", zeroOverdraw.Code, zeroOverdraw.Body.String())
	}
	var zeroErr apiErrorBody
	_ = json.Unmarshal(zeroOverdraw.Body.Bytes(), &zeroErr)
	if zeroErr.Error.Code != "INSUFFICIENT_STOCK" || zeroErr.Error.Available == nil || *zeroErr.Error.Available != 0 {
		t.Fatalf("expected INSUFFICIENT_STOCK with available=0, got body=%s", zeroOverdraw.Body.String())
	}

	// Verify NOTHING was written
	var moveCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM stock_movements WHERE product_id = $1`, p.ID).Scan(&moveCount)
	if moveCount != 0 {
		t.Fatalf("expected 0 movements after rejected overdraw, got %d", moveCount)
	}

	// Happy path: in 10, out 4 -> stock 6
	inRec := adjustStockHelper(t, router, p.ID, "in", 10, "Restock")
	if inRec.Code != http.StatusOK {
		t.Fatalf("in adjustment failed: %d %s", inRec.Code, inRec.Body.String())
	}
	outRec := adjustStockHelper(t, router, p.ID, "out", 4, "Dispatch")
	if outRec.Code != http.StatusOK {
		t.Fatalf("out adjustment failed: %d %s", outRec.Code, outRec.Body.String())
	}

	// Overdraw 7 when available is 6 -> 409 and stock stays 6, movement count stays 2
	overRec := adjustStockHelper(t, router, p.ID, "out", 7, "Too many")
	if overRec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", overRec.Code, overRec.Body.String())
	}
	var overErr apiErrorBody
	_ = json.Unmarshal(overRec.Body.Bytes(), &overErr)
	if overErr.Error.Code != "INSUFFICIENT_STOCK" || overErr.Error.Available == nil || *overErr.Error.Available != 6 {
		t.Fatalf("expected available=6, got %s", overRec.Body.String())
	}

	var stockAfter int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&stockAfter)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM stock_movements WHERE product_id = $1`, p.ID).Scan(&moveCount)
	if stockAfter != 6 || moveCount != 2 {
		t.Fatalf("expected stock=6 and movements=2 after rejected overdraw, got stock=%d movements=%d", stockAfter, moveCount)
	}

	// Movements list returns newest first
	mvRec := doJSON(t, router, http.MethodGet, fmt.Sprintf("/api/products/%d/movements", p.ID), nil)
	if mvRec.Code != http.StatusOK {
		t.Fatalf("list movements failed: %d", mvRec.Code)
	}
	var mvRes struct {
		Data []model.StockMovement `json:"data"`
	}
	_ = json.Unmarshal(mvRec.Body.Bytes(), &mvRes)
	if len(mvRes.Data) != 2 || mvRes.Data[0].Type != "out" || mvRes.Data[1].Type != "in" {
		t.Fatalf("expected newest-first movements [out, in], got %+v", mvRes.Data)
	}
}

func TestOrderValidationRejectsBeforeWriting(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p := createProductHelper(t, router, "SKU-VAL", "Pallet Jack", 1000000, true)
	adjustStockHelper(t, router, p.ID, "in", 10, "Seed")

	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty customer", map[string]any{"customer": "  ", "items": []map[string]any{{"sku": "SKU-VAL", "qty": 1}}}},
		{"empty items", map[string]any{"customer": "ACME", "items": []map[string]any{}}},
		{"zero qty", map[string]any{"customer": "ACME", "items": []map[string]any{{"sku": "SKU-VAL", "qty": 0}}}},
		{"negative qty", map[string]any{"customer": "ACME", "items": []map[string]any{{"sku": "SKU-VAL", "qty": -3}}}},
		{"duplicate sku", map[string]any{"customer": "ACME", "items": []map[string]any{{"sku": "SKU-VAL", "qty": 1}, {"sku": "SKU-VAL", "qty": 2}}}},
		{"unknown sku", map[string]any{"customer": "ACME", "items": []map[string]any{{"sku": "SKU-VAL", "qty": 1}, {"sku": "SKU-NOPE", "qty": 1}}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doJSON(t, router, http.MethodPost, "/api/orders", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}

	// Verify nothing was written and stock is still 10
	var stock, ordersCount, movementsCount int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&stock)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM sales_orders`).Scan(&ordersCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM stock_movements`).Scan(&movementsCount)
	if stock != 10 || ordersCount != 0 || movementsCount != 1 {
		t.Fatalf("expected untouched DB (stock=10, orders=0, movements=1), got stock=%d orders=%d movements=%d", stock, ordersCount, movementsCount)
	}
}

func TestOrderCreationHappyPathAndServerPricing(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p1 := createProductHelper(t, router, "SKU-1", "Item One", 125000, true)
	p2 := createProductHelper(t, router, "SKU-2", "Item Two", 300000, true)
	adjustStockHelper(t, router, p1.ID, "in", 10, "init")
	adjustStockHelper(t, router, p2.ID, "in", 10, "init")

	// Attempt to spoof unit_price and total from client -> server MUST ignore them
	rec := doJSON(t, router, http.MethodPost, "/api/orders", map[string]any{
		"customer": "PT Test Client",
		"total":    1,
		"items": []map[string]any{
			{"sku": "SKU-1", "qty": 3, "unit_price": 1},
			{"sku": "SKU-2", "qty": 2, "unit_price": 1},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var order model.SalesOrder
	if err := json.Unmarshal(rec.Body.Bytes(), &order); err != nil {
		t.Fatalf("decode order: %v", err)
	}
	expectedTotal := 3*125000 + 2*300000
	if order.Total != expectedTotal || order.Status != "CREATED" || len(order.Items) != 2 {
		t.Fatalf("unexpected order: %+v", order)
	}
	if order.Items[0].UnitPrice != 125000 || order.Items[1].UnitPrice != 300000 {
		t.Fatalf("expected DB unit_price values, got %+v", order.Items)
	}

	var s1, s2 int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE sku = 'SKU-1'`).Scan(&s1)
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE sku = 'SKU-2'`).Scan(&s2)
	if s1 != 7 || s2 != 8 {
		t.Fatalf("expected stock (7, 8), got (%d, %d)", s1, s2)
	}
}

func TestOrderCreationMultiItemAtomicityRollback(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p1 := createProductHelper(t, router, "SKU-OK", "Plenty Stock", 100000, true)
	p2 := createProductHelper(t, router, "SKU-LOW", "Scarce Stock", 200000, true)
	adjustStockHelper(t, router, p1.ID, "in", 10, "init")
	adjustStockHelper(t, router, p2.ID, "in", 2, "init")

	// First item succeeds, second item fails -> ENTIRE transaction must roll back
	rec := doJSON(t, router, http.MethodPost, "/api/orders", map[string]any{
		"customer": "Atomic Buyer",
		"items": []map[string]any{
			{"sku": "SKU-OK", "qty": 5},
			{"sku": "SKU-LOW", "qty": 3},
		},
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var errBody apiErrorBody
	_ = json.Unmarshal(rec.Body.Bytes(), &errBody)
	if errBody.Error.Code != "INSUFFICIENT_STOCK" || errBody.Error.SKU != "SKU-LOW" || errBody.Error.Available == nil || *errBody.Error.Available != 2 {
		t.Fatalf("unexpected 409 body: %s", rec.Body.String())
	}

	// Assert NOTHING changed anywhere
	var s1, s2, orderCount, itemCount, outMoveCount int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p1.ID).Scan(&s1)
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p2.ID).Scan(&s2)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM sales_orders`).Scan(&orderCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM sales_order_items`).Scan(&itemCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM stock_movements WHERE type = 'out'`).Scan(&outMoveCount)

	if s1 != 10 || s2 != 2 || orderCount != 0 || itemCount != 0 || outMoveCount != 0 {
		t.Fatalf("partial write detected on rollback: s1=%d s2=%d orders=%d items=%d outMoves=%d",
			s1, s2, orderCount, itemCount, outMoveCount)
	}
}

func TestOrderCancelRestoresStockAndBlocksDoubleCancel(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p := createProductHelper(t, router, "SKU-CXL", "Safety Vest", 80000, true)
	adjustStockHelper(t, router, p.ID, "in", 10, "init")

	createRec := doJSON(t, router, http.MethodPost, "/api/orders", map[string]any{
		"customer": "Cancel Co",
		"items":    []map[string]any{{"sku": "SKU-CXL", "qty": 4}},
	})
	var order model.SalesOrder
	_ = json.Unmarshal(createRec.Body.Bytes(), &order)

	// Cancel once -> 200 and stock restored to 10
	cancelRec := doJSON(t, router, http.MethodPost, fmt.Sprintf("/api/orders/%d/cancel", order.ID), nil)
	if cancelRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on cancel, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	var cancelled model.SalesOrder
	_ = json.Unmarshal(cancelRec.Body.Bytes(), &cancelled)
	if cancelled.Status != "CANCELLED" || cancelled.CancelledAt == nil {
		t.Fatalf("expected CANCELLED order with cancelled_at, got %+v", cancelled)
	}

	var stock int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&stock)
	if stock != 10 {
		t.Fatalf("expected stock restored to 10, got %d", stock)
	}

	// Cancel second time -> 409 and stock stays 10
	cancelAgain := doJSON(t, router, http.MethodPost, fmt.Sprintf("/api/orders/%d/cancel", order.ID), nil)
	if cancelAgain.Code != http.StatusConflict {
		t.Fatalf("expected 409 on second cancel, got %d: %s", cancelAgain.Code, cancelAgain.Body.String())
	}
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&stock)
	if stock != 10 {
		t.Fatalf("stock must not double-restore; expected 10, got %d", stock)
	}
}

func TestConcurrentOrdersSameSKU(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p := createProductHelper(t, router, "SKU-RACE", "Limited Scanner", 500000, true)
	adjustStockHelper(t, router, p.ID, "in", 5, "Initial stock")

	const workers = 20
	start := make(chan struct{})
	var wg sync.WaitGroup
	results := make([]int, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			body := fmt.Sprintf(`{"customer":"Buyer %d","items":[{"sku":"SKU-RACE","qty":1}]}`, idx)
			req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results[idx] = rec.Code
		}(i)
	}

	close(start)
	wg.Wait()

	var created, conflicts, others int
	for _, code := range results {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			others++
		}
	}

	if created != 5 || conflicts != 15 || others != 0 {
		t.Fatalf("expected 5 created, 15 conflicts, 0 others; got created=%d conflicts=%d others=%d", created, conflicts, others)
	}

	var finalStock, ledgerStock, orderCount int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&finalStock)
	_ = pool.QueryRow(ctx, `SELECT COALESCE(SUM(CASE WHEN type='in' THEN qty ELSE -qty END), 0) FROM stock_movements WHERE product_id = $1`, p.ID).Scan(&ledgerStock)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM sales_orders`).Scan(&orderCount)

	if finalStock != 0 || ledgerStock != 0 || orderCount != 5 {
		t.Fatalf("concurrency invariant violated: finalStock=%d ledgerStock=%d orderCount=%d", finalStock, ledgerStock, orderCount)
	}
}

func TestConcurrentOverlappingMultiSKUOrdersNoDeadlock(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	pA := createProductHelper(t, router, "SKU-ALPHA", "Alpha", 100000, true)
	pB := createProductHelper(t, router, "SKU-BETA", "Beta", 200000, true)
	adjustStockHelper(t, router, pA.ID, "in", 10, "init")
	adjustStockHelper(t, router, pB.ID, "in", 10, "init")

	const workers = 20
	start := make(chan struct{})
	var wg sync.WaitGroup
	results := make([]int, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			// Half request [ALPHA, BETA], half request [BETA, ALPHA] simultaneously
			var body string
			if idx%2 == 0 {
				body = fmt.Sprintf(`{"customer":"C%d","items":[{"sku":"SKU-ALPHA","qty":1},{"sku":"SKU-BETA","qty":1}]}`, idx)
			} else {
				body = fmt.Sprintf(`{"customer":"C%d","items":[{"sku":"SKU-BETA","qty":1},{"sku":"SKU-ALPHA","qty":1}]}`, idx)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/orders", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results[idx] = rec.Code
		}(i)
	}

	close(start)
	wg.Wait()

	var created, conflicts, others int
	for _, code := range results {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			others++
		}
	}

	if created != 10 || conflicts != 10 || others != 0 {
		t.Fatalf("expected 10 created, 10 conflicts, 0 others (no deadlocks); got created=%d conflicts=%d others=%d", created, conflicts, others)
	}

	var stockA, stockB int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, pA.ID).Scan(&stockA)
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, pB.ID).Scan(&stockB)
	if stockA != 0 || stockB != 0 {
		t.Fatalf("expected both stocks 0, got A=%d B=%d", stockA, stockB)
	}
}

func TestConcurrentOrderCancelOnlyRestoresOnce(t *testing.T) {
	pool, router := setupTestEnv(t)
	ctx := context.Background()

	p := createProductHelper(t, router, "SKU-DBL-CXL", "Crate", 150000, true)
	adjustStockHelper(t, router, p.ID, "in", 10, "init")

	createRec := doJSON(t, router, http.MethodPost, "/api/orders", map[string]any{
		"customer": "Race Cancel",
		"items":    []map[string]any{{"sku": "SKU-DBL-CXL", "qty": 4}},
	})
	var order model.SalesOrder
	_ = json.Unmarshal(createRec.Body.Bytes(), &order)

	const workers = 10
	start := make(chan struct{})
	var wg sync.WaitGroup
	results := make([]int, workers)

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/orders/%d/cancel", order.ID), nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results[idx] = rec.Code
		}(i)
	}

	close(start)
	wg.Wait()

	var okCount, conflictCount, otherCount int
	for _, code := range results {
		switch code {
		case http.StatusOK:
			okCount++
		case http.StatusConflict:
			conflictCount++
		default:
			otherCount++
		}
	}

	if okCount != 1 || conflictCount != 9 || otherCount != 0 {
		t.Fatalf("expected 1 ok, 9 conflicts, 0 others; got ok=%d conflict=%d other=%d", okCount, conflictCount, otherCount)
	}

	var stock int
	_ = pool.QueryRow(ctx, `SELECT stock FROM products WHERE id = $1`, p.ID).Scan(&stock)
	if stock != 10 {
		t.Fatalf("expected stock=10 (restored exactly once), got %d", stock)
	}
}
