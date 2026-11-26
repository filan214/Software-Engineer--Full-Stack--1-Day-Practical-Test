package model

import "time"

type Product struct {
	ID             int        `json:"id"`
	SKU            string     `json:"sku"`
	Name           string     `json:"name"`
	Price          int        `json:"price"`
	Stock          int        `json:"stock"`
	IsActive       bool       `json:"is_active"`
	CreatedAt      time.Time  `json:"created_at"`
	LastMovementAt *time.Time `json:"last_movement_at"`
}

type ProductListResponse struct {
	Data  []Product `json:"data"`
	Page  int       `json:"page"`
	Limit int       `json:"limit"`
	Total int       `json:"total"`
}

type ProductSummary struct {
	TotalProducts   int   `json:"total_products"`
	ActiveProducts  int   `json:"active_products"`
	TotalStockValue int64 `json:"total_stock_value"`
	LowStockCount   int   `json:"low_stock_count"`
}

type StockMovement struct {
	ID        int       `json:"id"`
	ProductID int       `json:"product_id"`
	Type      string    `json:"type"`
	Qty       int       `json:"qty"`
	Note      *string   `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type StockAdjustmentResponse struct {
	Product  Product       `json:"product"`
	Movement StockMovement `json:"movement"`
}

type SalesOrder struct {
	ID          int              `json:"id"`
	Customer    string           `json:"customer"`
	Status      string           `json:"status"`
	Total       int              `json:"total"`
	CreatedAt   time.Time        `json:"created_at"`
	CancelledAt *time.Time       `json:"cancelled_at"`
	Items       []SalesOrderItem `json:"items"`
}

type SalesOrderItem struct {
	ID          int    `json:"id"`
	OrderID     int    `json:"order_id"`
	SKU         string `json:"sku"`
	ProductName string `json:"product_name,omitempty"`
	Qty         int    `json:"qty"`
	UnitPrice   int    `json:"unit_price"`
}

type DailySalesReport struct {
	Date           string `json:"date"`
	OrdersCount    int    `json:"orders_count"`
	CancelledCount int    `json:"cancelled_count"`
	TotalRevenue   int64  `json:"total_revenue"`
	ItemsSold      int    `json:"items_sold"`
}
