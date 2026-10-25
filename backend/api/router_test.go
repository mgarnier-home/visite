package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestWebMountedLastKeepsAPINotFoundJSON(t *testing.T) {
	web := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html>index</html>"))
	})
	router := NewRouter(Deps{Web: web})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, attendu 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, attendu JSON", ct)
	}
	if strings.Contains(rec.Body.String(), "index") {
		t.Fatalf("/api/nope ne doit pas renvoyer index.html : %s", rec.Body)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v/abc", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "index") {
		t.Fatalf("/v/abc : code %d, corps %q", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/version", nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "index") {
		t.Fatalf("/version doit rester servi par la route de version : %d %q", rec.Code, rec.Body)
	}
}
