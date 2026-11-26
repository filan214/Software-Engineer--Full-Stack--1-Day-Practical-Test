package handler

import (
	"net/http"

	"stockflow/backend/internal/service"
)

type ProductHandler struct {
	products *service.ProductService
}

func NewProductHandler(products *service.ProductService) *ProductHandler {
	return &ProductHandler{products: products}
}

type createProductRequest struct {
	SKU      string `json:"sku"`
	Name     string `json:"name"`
	Price    *int   `json:"price"`
	IsActive *bool  `json:"is_active"`
}

type updateProductRequest struct {
	SKU      string `json:"sku"`
	Name     string `json:"name"`
	Price    *int   `json:"price"`
	IsActive *bool  `json:"is_active"`
}

type adjustStockRequest struct {
	Type string `json:"type"`
	Qty  int    `json:"qty"`
	Note string `json:"note"`
}

func (h *ProductHandler) List(w http.ResponseWriter, r *http.Request) {
	page, err := parseOptionalIntQuery(r, "page", 1)
	if err != nil {
		writeError(w, err)
		return
	}
	limit, err := parseOptionalIntQuery(r, "limit", 20)
	if err != nil {
		writeError(w, err)
		return
	}

	res, err := h.products.List(r.Context(), service.ProductListParams{
		Search: r.URL.Query().Get("search"),
		Filter: r.URL.Query().Get("filter"),
		Page:   page,
		Limit:  limit,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *ProductHandler) Summary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.products.Summary(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *ProductHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createProductRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}

	product, err := h.products.Create(r.Context(), service.CreateProductInput{
		SKU:      req.SKU,
		Name:     req.Name,
		Price:    req.Price,
		IsActive: req.IsActive,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, product)
}

func (h *ProductHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	var req updateProductRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}

	product, err := h.products.Update(r.Context(), id, service.UpdateProductInput{
		SKU:      req.SKU,
		Name:     req.Name,
		Price:    req.Price,
		IsActive: req.IsActive,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, product)
}

func (h *ProductHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	if err := h.products.Delete(r.Context(), id); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProductHandler) AdjustStock(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	var req adjustStockRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}

	res, err := h.products.AdjustStock(r.Context(), id, service.AdjustStockInput{
		Type: req.Type,
		Qty:  req.Qty,
		Note: req.Note,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *ProductHandler) ListMovements(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	movements, err := h.products.ListMovements(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": movements})
}
