package service

import (
	"fmt"
	"net/http"
)

type APIError struct {
	HTTPStatus int      `json:"-"`
	Code       string   `json:"code"`
	Message    string   `json:"message"`
	SKU        string   `json:"sku,omitempty"`
	Available  *int     `json:"available,omitempty"`
	Details    []string `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func ErrValidation(message string, details ...string) *APIError {
	return &APIError{
		HTTPStatus: http.StatusBadRequest,
		Code:       "VALIDATION_ERROR",
		Message:    message,
		Details:    details,
	}
}

func ErrNotFound(message string) *APIError {
	return &APIError{
		HTTPStatus: http.StatusNotFound,
		Code:       "NOT_FOUND",
		Message:    message,
	}
}

func ErrDuplicateSKU(sku string) *APIError {
	return &APIError{
		HTTPStatus: http.StatusConflict,
		Code:       "DUPLICATE_SKU",
		Message:    fmt.Sprintf("SKU %q already exists", sku),
		SKU:        sku,
	}
}

func ErrSKUInUse(sku string) *APIError {
	return &APIError{
		HTTPStatus: http.StatusConflict,
		Code:       "SKU_IN_USE",
		Message:    fmt.Sprintf("SKU %q cannot be changed because it is referenced by existing orders", sku),
		SKU:        sku,
	}
}

func ErrProductHasHistory() *APIError {
	return &APIError{
		HTTPStatus: http.StatusConflict,
		Code:       "PRODUCT_HAS_HISTORY",
		Message:    "Product cannot be deleted because it has stock movement or order history",
	}
}

func ErrInsufficientStock(sku string, available int) *APIError {
	avail := available
	msg := fmt.Sprintf("Insufficient stock (available: %d)", available)
	if sku != "" {
		msg = fmt.Sprintf("Insufficient stock for %s (available: %d)", sku, available)
	}
	return &APIError{
		HTTPStatus: http.StatusConflict,
		Code:       "INSUFFICIENT_STOCK",
		Message:    msg,
		SKU:        sku,
		Available:  &avail,
	}
}

func ErrOrderAlreadyCancelled(orderID int) *APIError {
	return &APIError{
		HTTPStatus: http.StatusConflict,
		Code:       "ORDER_ALREADY_CANCELLED",
		Message:    fmt.Sprintf("Order #%d is already cancelled", orderID),
	}
}
