package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/seed"
	"github.com/mgarnier-home/visite/store"
)

const (
	devA = "aaaaaaaa-0000-4000-8000-000000000001"
	devB = "bbbbbbbb-0000-4000-8000-000000000002"
	devC = "cccccccc-0000-4000-8000-000000000003"
)

// testStore est le store du dernier routeur de test créé (les tests ne sont pas parallèles).
var testStore *store.Store

// unknownID est un id d'annonce valide qui n'existe pas.
const unknownID = "00000000-0000-4000-8000-000000000000"

func newTestRouter(t *testing.T) *mux.Router {
	t.Helper()
	router, _ := newTestRouterWithPhotos(t)
	return router
}

// newTestRouterWithPhotos renvoie aussi la racine du stockage des photos.
func newTestRouterWithPhotos(t *testing.T) (*mux.Router, string) {
	t.Helper()
	photosRoot := t.TempDir()
	s, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	testStore = s
	tpl, err := seed.Template()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SeedTemplateIfEmpty(context.Background(), tpl); err != nil {
		t.Fatal(err)
	}
	return NewRouter(Deps{Store: s, Photos: photos.FS{Root: photosRoot}, Now: func() time.Time { return time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC) }}), photosRoot
}

func do(t *testing.T, router http.Handler, method, path, device, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if device != "" {
		req.Header.Set("X-Device-Id", device)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func wantCode(t *testing.T, rec *httptest.ResponseRecorder, code int) {
	t.Helper()
	if rec.Code != code {
		t.Fatalf("code = %d, attendu %d (corps %s)", rec.Code, code, rec.Body.String())
	}
	if rec.Code >= 400 {
		var e map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e["error"] == "" {
			t.Fatalf("corps d'erreur invalide : %s", rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("Content-Type = %q", ct)
		}
	}
}

// createVisit crée une annonce (donc sa visite), inscrit l'appareil et renvoie son id.
func createVisit(t *testing.T, router http.Handler, name, device string) string {
	t.Helper()
	l, err := testStore.CreateListing(context.Background(), model.Listing{
		Source: "manual", URL: "https://example.test/" + name,
	}, nil, time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	wantCode(t, do(t, router, "POST", "/api/listings/"+l.ID+"/visit/join", device, ""), http.StatusOK)
	return l.ID
}

func TestMissingOrInvalidDevice(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/join", "", ""), 400)
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/join", "pas-un-uuid", ""), 400)
	// Le paramètre ?d= est accepté.
	wantCode(t, do(t, router, "POST", "/api/listings/"+unknownID+"/visit/join?d="+devA, "", ""), 404)
}

func TestJoin(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	rec := do(t, router, "POST", "/api/listings/"+a+"/visit/join", devB, "")
	wantCode(t, rec, 200)
	if strings.TrimSpace(rec.Body.String()) != `{"number":2}` {
		t.Fatalf("corps %s", rec.Body.String())
	}
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/join", devB, ""), 200) // idempotent
	wantCode(t, do(t, router, "POST", "/api/listings/"+unknownID+"/visit/join", devB, ""), 404)
	wantCode(t, do(t, router, "POST", "/api/listings/A/visit/join", devB, ""), 400)
}

func TestStateAccess(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	rec := do(t, router, "GET", "/api/listings/"+a+"/visit", devA, "")
	var st model.VisitState
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Me.Number != 1 || st.Visit.Code != a || !strings.Contains(rec.Body.String(), `"rooms":[`) || strings.Contains(rec.Body.String(), `"photos":null`) {
		t.Fatalf("état inattendu : %s", rec.Body.String())
	}
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit", devA, ""), 200)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit", devC, ""), 403)
	wantCode(t, do(t, router, "GET", "/api/listings/"+unknownID+"/visit", devA, ""), 404)
	wantCode(t, do(t, router, "GET", "/api/listings/A/visit", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit", "", ""), 400)
}

func TestChangesSince(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/changes?since=0", devA, ""), 200)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/changes?since=abc", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/changes?since=-1", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/changes", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/changes?since=0", devC, ""), 403)
}

func TestOps(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	body := `{"ops":[{"op_id":"op-1","type":"set_comment","client_ts":1,"payload":{"room_id":"nope","text":"x"}},` +
		`{"op_id":"op-2","type":"inconnu","client_ts":1,"payload":{}}]}`
	rec := do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devA, body)
	wantCode(t, rec, 200)
	var resp struct {
		Seq     int64 `json:"seq"`
		Results []struct {
			OpID   string `json:"op_id"`
			Result string `json:"result"`
		} `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Results) != 2 || resp.Results[0].OpID != "op-1" || resp.Results[1].Result != "rejected" {
		t.Fatalf("résultats inattendus : %s", rec.Body.String())
	}

	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devC, body), 403)
	wantCode(t, do(t, router, "POST", "/api/listings/"+unknownID+"/visit/ops", devA, body), 404)
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devA, `{"ops":[{"op_id":"","type":"set_comment","client_ts":1,"payload":{}}]}`), 400)

	rec = do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devA, `{"ops":[]}`)
	wantCode(t, rec, 200)
	if !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("results doit être une liste vide : %s", rec.Body.String())
	}
}

func TestOpsLimits(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)

	one := `{"op_id":"op-1","type":"set_comment","client_ts":1,"payload":{}}`
	big := `{"ops":[` + strings.TrimSuffix(strings.Repeat(one+",", 501), ",") + `]}`
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devA, big), 413)

	huge := `{"ops":[{"op_id":"op-1","type":"set_comment","client_ts":1,"payload":{"text":"` +
		strings.Repeat("a", 1<<20) + `"}}]}`
	wantCode(t, do(t, router, "POST", "/api/listings/"+a+"/visit/ops", devA, huge), 413)
}

func TestUnknownAPIRouteIsJSON404(t *testing.T) {
	router := newTestRouter(t)
	wantCode(t, do(t, router, "GET", "/api/nimporte/quoi", devA, ""), 404)
}

func TestWrongMethodIsJSON405(t *testing.T) {
	router := newTestRouter(t)
	a := createVisit(t, router, "a", devA)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/join", devA, ""), 405)
	wantCode(t, do(t, router, "GET", "/api/listings/"+a+"/visit/ops", devA, ""), 405)
}
