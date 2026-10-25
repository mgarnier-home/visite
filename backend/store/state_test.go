package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/ops"
	"github.com/mgarnier-home/visite/seed"
	"github.com/mgarnier-home/visite/store"
)

const (
	devA = "aaaaaaaa-0000-4000-8000-000000000001" // créateur
	devB = "bbbbbbbb-0000-4000-8000-000000000002" // participant
)

var stateNow = time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)

const stateCode = "maison-test"

// newStateStore ouvre un store temporaire avec le modèle seed et une visite (A créateur, B participant).
func newStateStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	tpl, err := seed.Template()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SeedTemplateIfEmpty(ctx, tpl); err != nil {
		t.Fatal(err)
	}
	three := 3
	if err := s.CreateVisit(ctx, stateCode, model.Fiche{Address: "1 rue des Lilas", BedroomsCount: &three}, devA, stateNow); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, stateCode, devB, stateNow); err != nil {
		t.Fatal(err)
	}
	return s
}

func stateOp(id, typ string, ts int64, payload map[string]any) ops.Op {
	b, _ := json.Marshal(payload)
	return ops.Op{OpID: id, Type: typ, ClientTS: ts, Payload: b}
}

func mustApply(t *testing.T, s *store.Store, device string, batch ...ops.Op) int64 {
	t.Helper()
	res, seq, err := ops.ApplyBatch(context.Background(), s, stateCode, device, batch, stateNow)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Result != ops.ResultApplied {
			t.Fatalf("op %s : %s %s", r.OpID, r.Result, r.Reason)
		}
	}
	return seq
}

func mustState(t *testing.T, s *store.Store, device string, since int64) model.VisitState {
	t.Helper()
	st, err := s.State(context.Background(), stateCode, device, since)
	if err != nil {
		t.Fatalf("State: %v", err)
	}
	return st
}

func TestStateHidesOthersRatingsAndComments(t *testing.T) {
	s := newStateStore(t)
	st := mustState(t, s, devA, 0)
	pt, room := st.Points[0].ID, st.Rooms[0].ID
	mustApply(t, s, devA,
		stateOp("a1", ops.TypeSetRating, 1, map[string]any{"point_id": pt, "value": 5}),
		stateOp("a2", ops.TypeSetComment, 1, map[string]any{"room_id": room, "text": "texte de A"}))
	mustApply(t, s, devB,
		stateOp("b1", ops.TypeSetRating, 2, map[string]any{"point_id": pt, "value": 2}),
		stateOp("b2", ops.TypeSetComment, 2, map[string]any{"room_id": room, "text": "texte de B"}))

	got := mustState(t, s, devB, 0)
	if len(got.Ratings) != 1 || got.Ratings[0].Value == nil || *got.Ratings[0].Value != 2 {
		t.Errorf("notes de B = %+v", got.Ratings)
	}
	if len(got.Comments) != 1 || got.Comments[0].Text != "texte de B" {
		t.Errorf("commentaires de B = %+v", got.Comments)
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "texte de A") {
		t.Error("le commentaire de A fuit dans l'état de B")
	}
}

func TestStateSharesSharedValues(t *testing.T) {
	s := newStateStore(t)
	st := mustState(t, s, devA, 0)
	if len(st.Questions) == 0 {
		t.Fatal("la seed devrait fournir des questions")
	}
	q := st.Questions[0].ID
	mustApply(t, s, devA, stateOp("a1", ops.TypeSetShared, 1, map[string]any{"target_id": q, "field": "answer", "value": "réponse"}))

	got := mustState(t, s, devB, 0)
	if len(got.Shared) != 1 {
		t.Fatalf("shared = %+v", got.Shared)
	}
	sv := got.Shared[0]
	if sv.TargetID != q || sv.Field != "answer" || sv.Value != "réponse" || sv.Author != 1 {
		t.Errorf("shared = %+v", sv)
	}
}

func TestChangesSince(t *testing.T) {
	s := newStateStore(t)
	st := mustState(t, s, devA, 0)
	pt := st.Points[0].ID
	n := mustApply(t, s, devA, stateOp("a1", ops.TypeSetRating, 1, map[string]any{"point_id": pt, "value": 3}))

	full := mustState(t, s, devA, 0)
	if full.Seq != n {
		t.Fatalf("seq = %d, veut %d", full.Seq, n)
	}
	mustApply(t, s, devA, stateOp("a2", ops.TypeSetRating, 2, map[string]any{"point_id": pt, "value": 4}))

	ch := mustState(t, s, devA, n)
	if ch.Seq != n+1 {
		t.Errorf("seq = %d, veut %d", ch.Seq, n+1)
	}
	if len(ch.Ratings) != 1 || *ch.Ratings[0].Value != 4 {
		t.Errorf("ratings = %+v", ch.Ratings)
	}
	if len(ch.Rooms)+len(ch.Points)+len(ch.Questions)+len(ch.Shared)+len(ch.Comments)+len(ch.Photos) != 0 {
		t.Errorf("seule la note devait revenir : %+v", ch)
	}
	if ch.Visit.Code != stateCode {
		t.Error("visit doit toujours être présent")
	}
}

func TestStateSinceCurrentSeqIsEmpty(t *testing.T) {
	s := newStateStore(t)
	full := mustState(t, s, devA, 0)
	got := mustState(t, s, devA, full.Seq)
	if got.Visit.Code != stateCode || got.Visit.Participants != 2 {
		t.Errorf("visit = %+v", got.Visit)
	}
	for name, n := range map[string]int{"rooms": len(got.Rooms), "points": len(got.Points), "questions": len(got.Questions),
		"shared": len(got.Shared), "ratings": len(got.Ratings), "comments": len(got.Comments), "photos": len(got.Photos)} {
		if n != 0 {
			t.Errorf("%s non vide", name)
		}
	}
	b, _ := json.Marshal(got)
	for _, f := range []string{`"rooms":[]`, `"points":[]`, `"questions":[]`, `"shared":[]`, `"ratings":[]`, `"comments":[]`, `"photos":[]`} {
		if !strings.Contains(string(b), f) {
			t.Errorf("%s attendu dans %s", f, b)
		}
	}
}

func TestStateIsCreatorFlag(t *testing.T) {
	s := newStateStore(t)
	if !mustState(t, s, devA, 0).Visit.IsCreator {
		t.Error("A est créateur")
	}
	if mustState(t, s, devB, 0).Visit.IsCreator {
		t.Error("B n'est pas créateur")
	}
}

func TestStateParticipantsCount(t *testing.T) {
	s := newStateStore(t)
	a, b := mustState(t, s, devA, 0), mustState(t, s, devB, 0)
	if a.Visit.Participants != 2 || a.Me.Number != 1 || b.Me.Number != 2 {
		t.Errorf("A=%d/%d B=%d", a.Visit.Participants, a.Me.Number, b.Me.Number)
	}
	if _, err := s.State(context.Background(), stateCode, "cccccccc-0000-4000-8000-000000000003", 0); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("non-participant : %v", err)
	}
	if _, err := s.State(context.Background(), "inconnue", devA, 0); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("visite inconnue : %v", err)
	}
}

func TestStateIncludesHiddenRooms(t *testing.T) {
	s := newStateStore(t)
	room := mustState(t, s, devA, 0).Rooms[0].ID
	mustApply(t, s, devA, stateOp("a1", ops.TypeHideRoom, 1, map[string]any{"room_id": room}))
	for _, r := range mustState(t, s, devB, 0).Rooms {
		if r.ID == room {
			if !r.Hidden {
				t.Error("hidden devrait être vrai")
			}
			return
		}
	}
	t.Error("la pièce masquée doit rester dans l'état")
}
