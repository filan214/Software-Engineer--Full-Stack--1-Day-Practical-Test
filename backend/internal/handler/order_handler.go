package handler

import (
	"net/http"

	"stockflow/backend/internal/service"
)

type OrderHandler struct {
	orders *service.OrderService
}

func NewOrderHandler(orders *service.OrderService) *OrderHandler {
	return &OrderHandler{orders: orders}
}

type createOrderItemRequest struct {
	SKU string `json:"sku"`
	Qty int    `json:"qty"`
}

type createOrderRequest struct {
	Customer string                   `json:"customer"`
	Items    []createOrderItemRequest `json:"items"`
}

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createOrderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}

	items := make([]service.CreateOrderItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		items = append(items, service.CreateOrderItemInput{
			SKU: it.SKU,
			Qty: it.Qty,
		})
	}

	order, err := h.orders.Create(r.Context(), service.CreateOrderInput{
		Customer: req.Customer,
		Items:    items,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, order)
}

func (h *OrderHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, err := parseOptionalIntQuery(r, "limit", 50)
	if err != nil {
		writeError(w, err)
		return
	}

	orders, err := h.orders.List(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": orders})
}

func (h *OrderHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	order, err := h.orders.Get(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (h *OrderHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	id, err := parsePathID(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}

	order, err := h.orders.Cancel(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}
