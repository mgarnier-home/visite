package api

import (
	"strings"
	"testing"
)

func TestExportCSV(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)

	rec := do(t, router, "GET", "/api/visits/maison-a/export.csv?d="+devA, "", "")
	wantCode(t, rec, 200)
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="maison-a.csv"` {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	body := rec.Body.String()
	if !strings.HasPrefix(body, "\xef\xbb\xbfvisite;pièce;") {
		t.Fatalf("début = %q", body[:min(40, len(body))])
	}
}

func TestExportTSV(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)

	rec := do(t, router, "GET", "/api/visits/maison-a/export.csv?sep=tab", devA, "")
	wantCode(t, rec, 200)
	if ct := rec.Header().Get("Content-Type"); ct != "text/tab-separated-values; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="maison-a.tsv"` {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	if !strings.HasPrefix(rec.Body.String(), "visite\tpièce\t") {
		t.Fatalf("début = %q", rec.Body.String()[:30])
	}
}

func TestExportErrors(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/export.csv", "", ""), 400)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/export.csv", devC, ""), 403)
	wantCode(t, do(t, router, "GET", "/api/visits/inconnue-x/export.csv", devA, ""), 404)
}
