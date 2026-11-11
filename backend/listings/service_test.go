package listings

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/scrape"
	"github.com/mgarnier-home/visite/store"
)

type fakeFetcher struct {
	calls int
	res   scrape.Result
	err   error
}

func (f *fakeFetcher) Fetch(ctx context.Context, source, url string) (scrape.Result, error) {
	f.calls++
	return f.res, f.err
}

type env struct {
	svc  *Service
	f    *fakeFetcher
	srv  *httptest.Server
	root string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/missing.jpg":
			http.NotFound(w, r)
		case "/page.jpg":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("<html>"))
		case "/huge.jpg":
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write(bytes.Repeat([]byte("x"), 15<<20+1))
		default:
			w.Header().Set("Content-Type", "image/jpeg")
			w.Write([]byte("\xff\xd8\xff photo " + r.URL.Path))
		}
	}))
	t.Cleanup(srv.Close)
	root := t.TempDir()
	f := &fakeFetcher{}
	return &env{f: f, srv: srv, root: root, svc: &Service{
		Store: st, Photos: photos.FS{Root: root}, Fetcher: f,
		Download: func(ctx context.Context, url string) (*http.Response, error) {
			return (&scrape.Client{HTTP: srv.Client()}).Get(ctx, url)
		},
		Now: func() time.Time { return time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC) },
	}}
}

func TestCreateBienici(t *testing.T) {
	e := newEnv(t)
	e.f.res = scrape.Result{
		Data:      model.ListingData{Title: "Maison"},
		PhotoURLs: []string{e.srv.URL + "/a.jpg", e.srv.URL + "/b.jpg", e.srv.URL + "/c.jpg"},
	}
	l, err := e.svc.Create(context.Background(), "voir https://www.bienici.com/annonce/vente/x/maison/abc?q=1")
	if err != nil {
		t.Fatal(err)
	}
	if l.Source != "bienici" || l.Status != model.StatusContact || l.FetchedAt == nil || l.Title != "Maison" {
		t.Errorf("annonce inattendue : %+v", l)
	}
	got, err := e.svc.Store.GetListing(context.Background(), l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Photos) != 3 || got.FetchedAt == nil {
		t.Fatalf("photos = %d, fetched_at = %v", len(got.Photos), got.FetchedAt)
	}
	files, _ := filepath.Glob(filepath.Join(e.root, "listings", l.ID, "*.jpg"))
	if len(files) != 3 {
		t.Errorf("%d fichiers sous listings/%s, voulu 3", len(files), l.ID)
	}
}

func TestCreatePhotoFailures(t *testing.T) {
	e := newEnv(t)
	e.f.res = scrape.Result{PhotoURLs: []string{
		e.srv.URL + "/missing.jpg", e.srv.URL + "/page.jpg", e.srv.URL + "/huge.jpg",
		"http://example.com/a.jpg", e.srv.URL + "/ok.jpg",
	}}
	l, err := e.svc.Create(context.Background(), "https://www.jinka.fr/ad/abc")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := e.svc.Store.GetListing(context.Background(), l.ID)
	if len(got.Photos) != 1 {
		t.Fatalf("%d photos gardées, voulu 1", len(got.Photos))
	}
	entries, _ := os.ReadDir(filepath.Join(e.root, "listings", l.ID))
	if len(entries) != 1 {
		t.Errorf("%d fichiers, voulu 1", len(entries))
	}
}

func TestCreateManual(t *testing.T) {
	e := newEnv(t)
	l, err := e.svc.Create(context.Background(),
		"J'ai trouvé une annonce qui devrait vous intéresser sur leboncoin\n\n https://www.leboncoin.fr/ad/ventes_immobilieres/3306963410")
	if err != nil {
		t.Fatal(err)
	}
	want := "J'ai trouvé une annonce qui devrait vous intéresser sur leboncoin"
	if l.Source != "manual" || l.Title != want || e.f.calls != 0 {
		t.Errorf("source=%q titre=%q appels=%d", l.Source, l.Title, e.f.calls)
	}
}

func TestCreateDuplicate(t *testing.T) {
	e := newEnv(t)
	first, err := e.svc.Create(context.Background(), "https://www.jinka.fr/ad/abc?alert_id=1&utm_source=x")
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Create(context.Background(), "https://www.jinka.fr/ad/abc")
	var dup DuplicateError
	if !errors.As(err, &dup) || dup.ID != first.ID {
		t.Fatalf("err = %v, voulu DuplicateError{%s}", err, first.ID)
	}
	if e.f.calls != 1 {
		t.Errorf("Fetcher appelé %d fois, voulu 1", e.f.calls)
	}
}

func TestCreateNoLink(t *testing.T) {
	e := newEnv(t)
	if _, err := e.svc.Create(context.Background(), "Maison 5 pièces"); !errors.Is(err, ErrNoLink) {
		t.Errorf("err = %v", err)
	}
}

func TestCreateFetchError(t *testing.T) {
	e := newEnv(t)
	e.f.err = scrape.ErrFormat
	_, err := e.svc.Create(context.Background(), "https://www.jinka.fr/ad/abc")
	if !errors.Is(err, ErrFetch) || !errors.Is(err, scrape.ErrFormat) || strings.Contains(err.Error(), "<nil>") {
		t.Errorf("err = %v", err)
	}
	if ls, _ := e.svc.Store.ListListings(context.Background()); len(ls) != 0 {
		t.Errorf("%d annonces créées, voulu 0", len(ls))
	}
}
