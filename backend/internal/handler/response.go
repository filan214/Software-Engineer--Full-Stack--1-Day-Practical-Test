package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"stockflow/backend/internal/service"
)

type errorEnvelope struct {
	Error *service.APIError `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("failed to encode json response", "error", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	var apiErr *service.APIError
	if errors.As(err, &apiErr) {
		writeJSON(w, apiErr.HTTPStatus, errorEnvelope{Error: apiErr})
		return
	}

	slog.Error("unhandled server error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorEnvelope{
		Error: &service.APIError{
			HTTPStatus: http.StatusInternalServerError,
			Code:       "INTERNAL_ERROR",
			Message:    "Internal server error",
		},
	})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()

	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(dst); err != nil {
		var syntaxErr *json.SyntaxError
		var unmarshalErr *json.UnmarshalTypeError
		switch {
		case errors.Is(err, io.EOF):
			return service.ErrValidation("Request body is required")
		case errors.As(err, &syntaxErr):
			return service.ErrValidation(fmt.Sprintf("Malformed JSON at position %d", syntaxErr.Offset))
		case errors.As(err, &unmarshalErr):
			field := unmarshalErr.Field
			if field == "" {
				field = "body"
			}
			return service.ErrValidation(fmt.Sprintf("Invalid value for %q: expected %s", field, unmarshalErr.Type.String()))
		default:
			return service.ErrValidation("Invalid JSON request body")
		}
	}

	// Reject trailing garbage after the first JSON value.
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return service.ErrValidation("Request body must contain a single JSON object")
	}
	return nil
}

func parsePathID(r *http.Request, param string) (int, error) {
	raw := strings.TrimSpace(r.PathValue(param))
	id, err := strconv.Atoi(raw)
	if err != nil || id <= 0 {
		return 0, service.ErrValidation(fmt.Sprintf("Invalid %s: must be a positive integer", param))
	}
	return id, nil
}

func parseOptionalIntQuery(r *http.Request, key string, defaultVal int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return defaultVal, nil
	}
	val, err := strconv.Atoi(raw)
	if err != nil {
		return 0, service.ErrValidation(fmt.Sprintf("Invalid query parameter %q: must be an integer", key))
	}
	return val, nil
}
