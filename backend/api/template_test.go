package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mgarnier-home/visite/model"
)

func TestTemplateGetAndPut(t *testing.T) {
	router := newTestRouter(t)
	rec := do(t, router, "GET", "/api/template", devA, "")
	wantCode(t, rec, 200)
	var tpl model.Template
	if err := json.Unmarshal(rec.Body.Bytes(), &tpl); err != nil {
		t.Fatal(err)
	}
	if tpl.Version < 1 || len(tpl.Sections) == 0 {
		t.Fatalf("modèle = version %d, %d sections", tpl.Version, len(tpl.Sections))
	}

	tpl.PackingList = "mètre laser\nlampe"
	body, _ := json.Marshal(tpl)
	rec = do(t, router, "PUT", "/api/template", devA, string(body))
	wantCode(t, rec, 200)
	var saved model.Template
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Version != tpl.Version+1 || saved.PackingList != tpl.PackingList {
		t.Fatalf("enregistré = version %d, liste %q", saved.Version, saved.PackingList)
	}

	// Version périmée : 409.
	wantCode(t, do(t, router, "PUT", "/api/template", devA, string(body)), 409)
}

func TestTemplateErrors(t *testing.T) {
	router := newTestRouter(t)
	wantCode(t, do(t, router, "GET", "/api/template", "", ""), 400)
	wantCode(t, do(t, router, "PUT", "/api/template", "", `{}`), 400)
	wantCode(t, do(t, router, "PUT", "/api/template", devA, `pas du json`), 400)

	rec := do(t, router, "GET", "/api/template", devA, "")
	var tpl model.Template
	_ = json.Unmarshal(rec.Body.Bytes(), &tpl)
	tpl.Sections[1].Points[0].Type = "inconnu"
	body, _ := json.Marshal(tpl)
	wantCode(t, do(t, router, "PUT", "/api/template", devA, string(body)), 400)

	big := `{"packing_list":"` + strings.Repeat("a", 1<<20) + `"}`
	wantCode(t, do(t, router, "PUT", "/api/template", devA, big), 413)
}
