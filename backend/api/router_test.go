package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVersionRouteResponds(t *testing.T) {
	router := NewRouter(Deps{})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/version", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, attendu %d", rec.Code, http.StatusOK)
	}
}
