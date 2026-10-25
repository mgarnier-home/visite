package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestSPAFallback(t *testing.T) {
	h := handler(fstest.MapFS{
		"index.html":      {Data: []byte("<html>index</html>")},
		"main.js":         {Data: []byte("console.log(1)")},
		"ngsw.json":       {Data: []byte("{}")},
		"ngsw-worker.js":  {Data: []byte("//sw")},
		"assets/logo.svg": {Data: []byte("<svg/>")},
	})

	t.Run("route SPA renvoie index.html", func(t *testing.T) {
		rec := get(t, h, "/v/abc")
		if rec.Code != 200 || rec.Body.String() != "<html>index</html>" {
			t.Fatalf("code %d, corps %q", rec.Code, rec.Body)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Fatalf("Content-Type = %q", ct)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("Cache-Control = %q", cc)
		}
	})
	t.Run("racine renvoie index.html", func(t *testing.T) {
		rec := get(t, h, "/")
		if rec.Code != 200 || rec.Body.String() != "<html>index</html>" {
			t.Fatalf("code %d, corps %q", rec.Code, rec.Body)
		}
	})
	t.Run("fichier existant servi tel quel", func(t *testing.T) {
		rec := get(t, h, "/main.js")
		if rec.Code != 200 || rec.Body.String() != "console.log(1)" {
			t.Fatalf("code %d, corps %q", rec.Code, rec.Body)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
			t.Fatalf("Content-Type = %q", ct)
		}
		if cc := rec.Header().Get("Cache-Control"); cc == "no-cache" {
			t.Fatalf("main.js ne doit pas être no-cache")
		}
	})
	t.Run("fichiers du service worker en no-cache", func(t *testing.T) {
		for _, p := range []string{"/ngsw.json", "/ngsw-worker.js", "/index.html"} {
			rec := get(t, h, p)
			if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-cache" {
				t.Fatalf("%s : code %d, Cache-Control %q", p, rec.Code, rec.Header().Get("Cache-Control"))
			}
		}
	})
	t.Run("un dossier ne liste pas son contenu", func(t *testing.T) {
		rec := get(t, h, "/assets/")
		if rec.Body.String() != "<html>index</html>" {
			t.Fatalf("corps %q", rec.Body)
		}
	})
}

func TestMissingIndex(t *testing.T) {
	h := handler(fstest.MapFS{})
	for _, p := range []string{"/", "/v/abc"} {
		rec := get(t, h, p)
		if rec.Code != 404 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") ||
			!strings.Contains(rec.Body.String(), "frontend non construit") {
			t.Fatalf("%s : code %d, ct %q, corps %q", p, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
		}
	}
}
