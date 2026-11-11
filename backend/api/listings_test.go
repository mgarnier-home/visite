package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/listings"
	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/scrape"
)

type stubFetcher struct {
	res scrape.Result
	err error
}

func (f *stubFetcher) Fetch(context.Context, string, string) (scrape.Result, error) {
	return f.res, f.err
}

func newListingsRouter(t *testing.T, f *stubFetcher, dl func(context.Context, string) (*http.Response, error)) (*mux.Router, string) {
	t.Helper()
	_, root := newTestRouterWithPhotos(t)
	now := func() time.Time { return time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC) }
	svc := &listings.Service{Store: testStore, Photos: photos.FS{Root: root}, Fetcher: f, Download: dl, Now: now}
	return NewRouter(Deps{Store: testStore, Photos: photos.FS{Root: root}, Now: now, Listings: svc}), root
}

const bieniciText = "Regarde https://www.bienici.com/annonce/vente/nantes/maison/abc123?x=1"

func TestListingsAPI(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("png-bytes"))
	}))
	defer srv.Close()
	f := &stubFetcher{res: scrape.Result{Data: model.ListingData{Title: "Maison"}, PhotoURLs: []string{srv.URL + "/a.png"}}}
	router, root := newListingsRouter(t, f, (&scrape.Client{HTTP: srv.Client()}).Get)

	rec := do(t, router, "POST", "/api/listings", "", `{"text":`+jsonString(bieniciText)+`}`)
	wantCode(t, rec, http.StatusCreated)
	var l model.Listing
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil || l.Title != "Maison" || len(l.Photos) != 1 {
		t.Fatalf("annonce : %+v, %v", l, err)
	}

	rec = do(t, router, "POST", "/api/listings", "", `{"text":`+jsonString(bieniciText)+`}`)
	wantCode(t, rec, http.StatusConflict)
	var dup map[string]string
	json.Unmarshal(rec.Body.Bytes(), &dup)
	if dup["id"] != l.ID {
		t.Fatalf("409 : %s", rec.Body.String())
	}

	wantCode(t, do(t, router, "POST", "/api/listings", "", `{"text":"rien"}`), http.StatusUnprocessableEntity)
	wantCode(t, do(t, router, "POST", "/api/listings", "", `pas du json`), http.StatusBadRequest)
	f.err = errors.New("boum")
	wantCode(t, do(t, router, "POST", "/api/listings", "", `{"text":"https://www.bienici.com/annonce/vente/x/maison/zzz"}`), http.StatusBadGateway)

	rec = do(t, router, "GET", "/api/listings", "", "")
	wantCode(t, rec, http.StatusOK)
	var all []model.Listing
	json.Unmarshal(rec.Body.Bytes(), &all)
	if len(all) != 1 {
		t.Fatalf("liste : %s", rec.Body.String())
	}

	wantCode(t, do(t, router, "GET", "/api/listings/"+l.ID, "", ""), http.StatusOK)
	wantCode(t, do(t, router, "GET", "/api/listings/"+unknownID, "", ""), http.StatusNotFound)
	wantCode(t, do(t, router, "GET", "/api/listings/pas-un-uuid", "", ""), http.StatusBadRequest)

	rec = do(t, router, "PATCH", "/api/listings/"+l.ID, "", `{"status":"mail","notes":"ok"}`)
	wantCode(t, rec, http.StatusOK)
	json.Unmarshal(rec.Body.Bytes(), &l)
	if l.Status != model.StatusMail || l.Notes != "ok" || l.MailSentAt == nil {
		t.Fatalf("patch : %+v", l)
	}
	wantCode(t, do(t, router, "PATCH", "/api/listings/"+l.ID, "", `{"status":"planned"}`), http.StatusBadRequest)
	wantCode(t, do(t, router, "PATCH", "/api/listings/"+l.ID, "", `{"raw":"x"}`), http.StatusBadRequest)
	wantCode(t, do(t, router, "PATCH", "/api/listings/"+unknownID, "", `{"notes":"x"}`), http.StatusNotFound)

	rec = do(t, router, "GET", "/api/listings/"+l.ID+"/photos/"+l.Photos[0].ID, "", "")
	wantCode(t, rec, http.StatusOK)
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" || rec.Body.String() != "png-bytes" {
		t.Fatalf("photo : %q %q", ct, rec.Body.String())
	}
	wantCode(t, do(t, router, "GET", "/api/listings/"+l.ID+"/photos/"+unknownID, "", ""), http.StatusNotFound)

	// Fichiers de visite (<id>/) et d'annonce (listings/<id>/) disparaissent avec l'annonce.
	os.MkdirAll(filepath.Join(root, l.ID, "salon"), 0o755)
	os.WriteFile(filepath.Join(root, l.ID, "salon", "p.jpg"), []byte("x"), 0o644)
	if _, err := os.Stat(filepath.Join(root, "listings", l.ID)); err != nil {
		t.Fatal(err)
	}
	wantCode(t, do(t, router, "DELETE", "/api/listings/"+l.ID, "", ""), http.StatusNoContent)
	for _, d := range []string{l.ID, filepath.Join("listings", l.ID)} {
		if _, err := os.Stat(filepath.Join(root, d)); !os.IsNotExist(err) {
			t.Fatalf("%s existe encore (%v)", d, err)
		}
	}
	wantCode(t, do(t, router, "DELETE", "/api/listings/"+l.ID, "", ""), http.StatusNotFound)
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
