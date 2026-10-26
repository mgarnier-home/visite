package store_test

import (
	"context"
	"testing"

	"github.com/mgarnier-home/visite/ops"
	"github.com/mgarnier-home/visite/store"
)

func TestExportDataByParticipant(t *testing.T) {
	s := newStateStore(t)
	st := mustState(t, s, devA, 0)
	pt, room, q := st.Points[0].ID, st.Rooms[0].ID, st.Questions[0].ID
	mustApply(t, s, devA,
		stateOp("a1", ops.TypeSetRating, 1, map[string]any{"point_id": pt, "value": 5}),
		stateOp("a2", ops.TypeSetComment, 1, map[string]any{"room_id": room, "text": "texte de A"}),
		stateOp("a3", ops.TypeSetShared, 1, map[string]any{"target_id": q, "field": "answer", "value": "oui"}),
		stateOp("a4", ops.TypeSetShared, 1, map[string]any{"target_id": stateCode, "field": "notes", "value": "notes de la visite"}))
	mustApply(t, s, devB,
		stateOp("b1", ops.TypeSetRating, 2, map[string]any{"point_id": pt, "value": nil}),
		stateOp("b2", ops.TypeSetComment, 2, map[string]any{"room_id": room, "text": "texte de B"}))

	d, err := s.ExportData(context.Background(), stateCode)
	if err != nil {
		t.Fatal(err)
	}
	if d.Participants != 2 || d.Year != 0 || d.Fiche.Address != "1 rue des Lilas" {
		t.Errorf("données générales = %d %d %q", d.Participants, d.Year, d.Fiche.Address)
	}
	if len(d.Rooms) != len(st.Rooms) || len(d.Points) != len(st.Points) || len(d.Questions) != len(st.Questions) {
		t.Errorf("structure incomplète : %d/%d/%d", len(d.Rooms), len(d.Points), len(d.Questions))
	}
	if r := d.Ratings[pt]; r[1] == nil || *r[1] != 5 {
		t.Errorf("note de P1 = %v", r[1])
	}
	if v, ok := d.Ratings[pt][2]; !ok || v != nil {
		t.Errorf("note de P2 = %v (présente : %v), attendu N/A", v, ok)
	}
	if d.Comments[room][1] != "texte de A" || d.Comments[room][2] != "texte de B" {
		t.Errorf("commentaires = %v", d.Comments[room])
	}
	if string(d.Shared[q]["answer"]) != `"oui"` {
		t.Errorf("shared = %s", d.Shared[q]["answer"])
	}
	if string(d.Shared[stateCode]["notes"]) != `"notes de la visite"` {
		t.Errorf("notes de la visite = %s", d.Shared[stateCode]["notes"])
	}
}

func TestExportDataUnknownVisit(t *testing.T) {
	s := newStateStore(t)
	if _, err := s.ExportData(context.Background(), "inconnue-xx"); err != store.ErrNotFound {
		t.Errorf("err = %v, attendu ErrNotFound", err)
	}
}
