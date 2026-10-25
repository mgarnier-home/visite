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
	"github.com/mgarnier-home/visite/seed"
	"github.com/mgarnier-home/visite/store"
)

const (
	devA = "aaaaaaaa-0000-4000-8000-000000000001"
	devB = "bbbbbbbb-0000-4000-8000-000000000002"
	devC = "cccccccc-0000-4000-8000-000000000003"
)

func newTestRouter(t *testing.T) *mux.Router {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	tpl, err := seed.Template()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SeedTemplateIfEmpty(context.Background(), tpl); err != nil {
		t.Fatal(err)
	}
	return NewRouter(Deps{Store: s, Now: func() time.Time { return time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC) }})
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

func createVisit(t *testing.T, router http.Handler, code, device string) {
	t.Helper()
	body := `{"code":"` + code + `","fiche":{"address":"1 rue des Lilas"}}`
	wantCode(t, do(t, router, "POST", "/api/visits", device, body), http.StatusCreated)
}

func TestMissingOrInvalidDevice(t *testing.T) {
	router := newTestRouter(t)
	wantCode(t, do(t, router, "POST", "/api/visits", "", `{"code":"maison-a","fiche":{}}`), 400)
	wantCode(t, do(t, router, "POST", "/api/visits", "pas-un-uuid", `{"code":"maison-a","fiche":{}}`), 400)
	// Le paramètre ?d= est accepté.
	rec := do(t, router, "POST", "/api/visits/inconnue-a/join?d="+devA, "", "")
	wantCode(t, rec, 404)
}

func TestCreateVisit(t *testing.T) {
	router := newTestRouter(t)
	body := `{"code":"maison-a","fiche":{"address":"1 rue des Lilas"}}`
	rec := do(t, router, "POST", "/api/visits", devA, body)
	wantCode(t, rec, 201)
	var st model.VisitState
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Me.Number != 1 || st.Visit.Code != "maison-a" || !st.Visit.IsCreator {
		t.Fatalf("état inattendu : %+v", st.Me)
	}
	if !strings.Contains(rec.Body.String(), `"rooms":[`) || strings.Contains(rec.Body.String(), `"photos":null`) {
		t.Fatalf("listes attendues non nulles : %s", rec.Body.String())
	}
	wantCode(t, do(t, router, "POST", "/api/visits", devB, body), 409)
	wantCode(t, do(t, router, "POST", "/api/visits", devA, `{"code":"A","fiche":{}}`), 400)
	wantCode(t, do(t, router, "POST", "/api/visits", devA, `{pas du json`), 400)
}

func TestExists(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	for code, want := range map[string]string{"maison-a": `{"exists":true}`, "autre-code": `{"exists":false}`} {
		rec := do(t, router, "GET", "/api/visits/"+code+"/exists", "", "")
		wantCode(t, rec, 200)
		if strings.TrimSpace(rec.Body.String()) != want {
			t.Errorf("%s : corps %s, attendu %s", code, rec.Body.String(), want)
		}
	}
	wantCode(t, do(t, router, "GET", "/api/visits/A/exists", "", ""), 400)
}

func TestJoin(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	rec := do(t, router, "POST", "/api/visits/maison-a/join", devB, "")
	wantCode(t, rec, 200)
	if strings.TrimSpace(rec.Body.String()) != `{"number":2}` {
		t.Fatalf("corps %s", rec.Body.String())
	}
	wantCode(t, do(t, router, "POST", "/api/visits/maison-a/join", devB, ""), 200) // idempotent
	wantCode(t, do(t, router, "POST", "/api/visits/inconnue-a/join", devB, ""), 404)
	wantCode(t, do(t, router, "POST", "/api/visits/A/join", devB, ""), 400)
}

func TestStateAccess(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a", devA, ""), 200)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a", devC, ""), 403)
	wantCode(t, do(t, router, "GET", "/api/visits/inconnue-a", devA, ""), 404)
	wantCode(t, do(t, router, "GET", "/api/visits/A", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a", "", ""), 400)
}

func TestChangesSince(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/changes?since=0", devA, ""), 200)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/changes?since=abc", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/changes?since=-1", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/changes", devA, ""), 400)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/changes?since=0", devC, ""), 403)
}

func TestOps(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	body := `{"ops":[{"op_id":"op-1","type":"set_comment","client_ts":1,"payload":{"room_id":"nope","text":"x"}},` +
		`{"op_id":"op-2","type":"inconnu","client_ts":1,"payload":{}}]}`
	rec := do(t, router, "POST", "/api/visits/maison-a/ops", devA, body)
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

	wantCode(t, do(t, router, "POST", "/api/visits/maison-a/ops", devC, body), 403)
	wantCode(t, do(t, router, "POST", "/api/visits/inconnue-a/ops", devA, body), 404)
	wantCode(t, do(t, router, "POST", "/api/visits/maison-a/ops", devA, `{"ops":[{"op_id":"","type":"close_visit","client_ts":1,"payload":{}}]}`), 400)

	rec = do(t, router, "POST", "/api/visits/maison-a/ops", devA, `{"ops":[]}`)
	wantCode(t, rec, 200)
	if !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("results doit être une liste vide : %s", rec.Body.String())
	}
}

func TestOpsLimits(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)

	one := `{"op_id":"op-1","type":"close_visit","client_ts":1,"payload":{}}`
	big := `{"ops":[` + strings.TrimSuffix(strings.Repeat(one+",", 501), ",") + `]}`
	wantCode(t, do(t, router, "POST", "/api/visits/maison-a/ops", devA, big), 413)

	huge := `{"ops":[{"op_id":"op-1","type":"set_comment","client_ts":1,"payload":{"text":"` +
		strings.Repeat("a", 1<<20) + `"}}]}`
	wantCode(t, do(t, router, "POST", "/api/visits/maison-a/ops", devA, huge), 413)
}

func TestUnknownAPIRouteIsJSON404(t *testing.T) {
	router := newTestRouter(t)
	wantCode(t, do(t, router, "GET", "/api/nimporte/quoi", devA, ""), 404)
}
