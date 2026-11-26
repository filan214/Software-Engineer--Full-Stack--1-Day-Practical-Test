package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"stockflow/backend/internal/service"
)

func NewRouter(pool *pgxpool.Pool, corsOrigin string) http.Handler {
	productSvc := service.NewProductService(pool)
	orderSvc := service.NewOrderService(pool)

	productHandler := NewProductHandler(productSvc)
	orderHandler := NewOrderHandler(orderSvc)

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Products & stock movements
	mux.HandleFunc("GET /api/products", productHandler.List)
	mux.HandleFunc("GET /api/products/summary", productHandler.Summary)
	mux.HandleFunc("POST /api/products", productHandler.Create)
	mux.HandleFunc("PUT /api/products/{id}", productHandler.Update)
	mux.HandleFunc("DELETE /api/products/{id}", productHandler.Delete)
	mux.HandleFunc("POST /api/products/{id}/stock", productHandler.AdjustStock)
	mux.HandleFunc("GET /api/products/{id}/movements", productHandler.ListMovements)

	// Sales orders & reports
	mux.HandleFunc("GET /api/orders", orderHandler.List)
	mux.HandleFunc("POST /api/orders", orderHandler.Create)
	mux.HandleFunc("GET /api/orders/{id}", orderHandler.Get)
	mux.HandleFunc("POST /api/orders/{id}/cancel", orderHandler.Cancel)
	mux.HandleFunc("GET /api/reports/daily-sales", orderHandler.DailySalesReport)

	return withRecovery(withRequestLogger(withCORS(corsOrigin, mux)))
}
