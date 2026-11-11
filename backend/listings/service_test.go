package listings

import (
	"bytes"
	"context"
	"encoding/json"
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
	calls  int
	res    scrape.Result
	err    error
	errFor map[string]error // erreur par URL, prioritaire sur err
}

func (f *fakeFetcher) Fetch(ctx context.Context, source, url string) (scrape.Result, error) {
	f.calls++
	if err, ok := f.errFor[url]; ok {
		return scrape.Result{}, err
	}
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

func TestCreateManualRawLink(t *testing.T) {
	e := newEnv(t)
	l, err := e.svc.Create(context.Background(),
		"J'ai trouvé une annonce qui devrait vous intéresser sur leboncoin\n\n https://www.leboncoin.fr/ad/ventes_immobilieres/3306963410?utm_source=x#top")
	if err != nil {
		t.Fatal(err)
	}
	if want := "J'ai trouvé une annonce qui devrait vous intéresser sur leboncoin"; l.Title != want {
		t.Errorf("titre = %q", l.Title)
	}
}

const bieniciURL = "https://www.bienici.com/annonce/vente/x/maison/"

func f64(v float64) *float64 { return &v }

func create(t *testing.T, e *env, suffix string, status model.ListingStatus) model.Listing {
	t.Helper()
	l, err := e.svc.Create(context.Background(), bieniciURL+suffix)
	if err != nil {
		t.Fatal(err)
	}
	if status != "" {
		if l, err = e.svc.Store.UpdateListing(context.Background(), l.ID,
			map[string]json.RawMessage{"status": json.RawMessage(`"` + string(status) + `"`)}, e.svc.Now()); err != nil {
			t.Fatal(err)
		}
	}
	return l
}

func TestRefreshKeepsTracking(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.f.res = scrape.Result{Data: model.ListingData{Title: "Maison", PriceEUR: f64(300000)}}
	l := create(t, e, "a", "")
	_, err := e.svc.Store.UpdateListing(ctx, l.ID, map[string]json.RawMessage{
		"status": json.RawMessage(`"planned"`), "visit_at": json.RawMessage(`"2026-12-01T10:00:00Z"`),
		"address": json.RawMessage(`"1 rue X"`), "notes": json.RawMessage(`"vu"`), "price_eur": json.RawMessage(`290000`),
	}, e.svc.Now())
	if err != nil {
		t.Fatal(err)
	}
	e.f.res = scrape.Result{Data: model.ListingData{Title: "Maison", PriceEUR: f64(280000)}}
	got, err := e.svc.Refresh(ctx, l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if *got.PriceEUR != 280000 || got.Status != model.StatusPlanned || got.VisitAt == nil ||
		*got.VisitAt != "2026-12-01T10:00:00Z" || got.Address != "1 rue X" || got.Notes != "vu" {
		t.Errorf("annonce inattendue : %+v", got)
	}
}

func TestRefreshAddsNewPhotos(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, b, c := e.srv.URL+"/a.jpg", e.srv.URL+"/b.jpg", e.srv.URL+"/c.jpg"
	e.f.res = scrape.Result{PhotoURLs: []string{a, b}}
	l := create(t, e, "a", "")
	e.f.res = scrape.Result{PhotoURLs: []string{a, c}}
	got, err := e.svc.Refresh(ctx, l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Photos) != 3 {
		t.Fatalf("%d photos, voulu 3", len(got.Photos))
	}
	for i, p := range got.Photos {
		if p.Position != i {
			t.Errorf("photo %d en position %d", i, p.Position)
		}
	}
}

func TestRefreshRemoved(t *testing.T) {
	e := newEnv(t)
	e.f.res = scrape.Result{Data: model.ListingData{Title: "Maison", PriceEUR: f64(1)}}
	l := create(t, e, "a", "")
	e.f.err = scrape.ErrRemoved
	got, err := e.svc.Refresh(context.Background(), l.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RemovedAt == nil || got.Title != "Maison" || got.FetchError != "" {
		t.Errorf("annonce inattendue : %+v", got)
	}
}

func TestRefreshFormatError(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.f.res = scrape.Result{Data: model.ListingData{PriceEUR: f64(1)}}
	l := create(t, e, "a", "")
	e.f.err = scrape.ErrFormat
	if _, err := e.svc.Refresh(ctx, l.ID); !errors.Is(err, ErrFetch) || !errors.Is(err, scrape.ErrFormat) {
		t.Fatalf("err = %v", err)
	}
	got, _ := e.svc.Store.GetListing(ctx, l.ID)
	if got.FetchError == "" || *got.PriceEUR != 1 || got.RemovedAt != nil {
		t.Errorf("après échec : %+v", got)
	}
	e.f.err = nil
	e.f.res = scrape.Result{Data: model.ListingData{PriceEUR: f64(2)}}
	got, err := e.svc.Refresh(ctx, l.ID)
	if err != nil || got.FetchError != "" || *got.PriceEUR != 2 {
		t.Errorf("après succès : %+v, %v", got, err)
	}
}

func TestRefreshManual(t *testing.T) {
	e := newEnv(t)
	l, err := e.svc.Create(context.Background(), "x https://www.leboncoin.fr/ad/ventes_immobilieres/1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Refresh(context.Background(), l.ID); !errors.Is(err, ErrManual) {
		t.Errorf("err = %v", err)
	}
}

func TestRefreshAll(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.f.res = scrape.Result{Data: model.ListingData{PriceEUR: f64(1)}}
	create(t, e, "ok", "")
	bad := create(t, e, "bad", "")
	create(t, e, "dropped", model.StatusDropped)
	if _, err := e.svc.Create(ctx, "x https://www.leboncoin.fr/ad/ventes_immobilieres/1"); err != nil {
		t.Fatal(err)
	}
	e.f.calls = 0
	e.f.errFor = map[string]error{bieniciURL + "bad": scrape.ErrFormat}
	rep, err := e.svc.RefreshAll(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if e.f.calls != 2 || rep.Updated != 1 || rep.Removed != 0 || len(rep.Failed) != 1 || rep.Failed[0].ID != bad.ID || rep.Failed[0].Error == "" {
		t.Errorf("calls=%d rapport=%+v", e.f.calls, rep)
	}
}
