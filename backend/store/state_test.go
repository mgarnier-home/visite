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

const devC = "cccccccc-0000-4000-8000-000000000003"

func photoRec(id string, room *string, device string) store.PhotoRecord {
	return store.PhotoRecord{ID: id, VisitCode: stateCode, RoomID: room, DeviceID: device,
		TakenAt: time.Date(2026, 10, 25, 14, 35, 20, 0, time.FixedZone("", 2*3600)),
		Path:    "maison-test/" + id + ".jpg", Size: 1234}
}

func TestAddPhotoIdempotent(t *testing.T) {
	s := newStateStore(t)
	ctx := context.Background()
	rec := photoRec("11111111-0000-4000-8000-000000000001", nil, devA)
	created, err := s.AddPhoto(ctx, rec)
	if err != nil || !created {
		t.Fatalf("premier ajout : %v %v", created, err)
	}
	seq := mustState(t, s, devA, 0).Seq
	created, err = s.AddPhoto(ctx, rec)
	if err != nil || created {
		t.Fatalf("second ajout : %v %v", created, err)
	}
	st := mustState(t, s, devA, 0)
	if st.Seq != seq || len(st.Photos) != 1 {
		t.Errorf("seq %d -> %d, photos %d", seq, st.Seq, len(st.Photos))
	}
	if st.Photos[0].TakenAt != "2026-10-25T14:35:20+02:00" {
		t.Errorf("taken_at = %q (le décalage du téléphone doit être conservé)", st.Photos[0].TakenAt)
	}
	p, err := s.PhotoPathByID(ctx, stateCode, rec.ID)
	if err != nil || p != rec.Path {
		t.Errorf("PhotoPathByID = %q, %v", p, err)
	}
	if _, err := s.PhotoPathByID(ctx, stateCode, "inconnue"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("photo inconnue : %v", err)
	}
	if _, err := s.PhotoPathByID(ctx, "autre", rec.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("mauvaise visite : %v", err)
	}
}

func TestAddPhotoErrors(t *testing.T) {
	s := newStateStore(t)
	ctx := context.Background()
	bad := "nope"
	if _, err := s.AddPhoto(ctx, photoRec("p1", &bad, devA)); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("pièce inconnue : %v", err)
	}
	rec := photoRec("p2", nil, devA)
	rec.VisitCode = "inconnue"
	if _, err := s.AddPhoto(ctx, rec); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("visite inconnue : %v", err)
	}
	// Pièce d'une autre visite.
	if err := s.CreateVisit(ctx, "autre-visite", model.Fiche{Address: "x"}, devA, stateNow); err != nil {
		t.Fatal(err)
	}
	other, err := s.State(ctx, "autre-visite", devA, 0)
	if err != nil {
		t.Fatal(err)
	}
	foreign := other.Rooms[0].ID
	if _, err := s.AddPhoto(ctx, photoRec("p3", &foreign, devA)); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("pièce d'une autre visite : %v", err)
	}
}

func TestAddPhotoClosedVisit(t *testing.T) {
	s := newStateStore(t)
	mustApply(t, s, devA, stateOp("c1", ops.TypeCloseVisit, 1, map[string]any{}))
	if _, err := s.AddPhoto(context.Background(), photoRec("p1", nil, devA)); !errors.Is(err, store.ErrClosed) {
		t.Errorf("visite clôturée : %v", err)
	}
}

func TestRoomDirName(t *testing.T) {
	s := newStateStore(t)
	ctx := context.Background()
	r := mustState(t, s, devA, 0).Rooms[0]
	got, err := s.RoomDirName(ctx, stateCode, r.ID)
	if err != nil || got != r.DirName {
		t.Errorf("RoomDirName = %q, %v (veut %q)", got, err, r.DirName)
	}
	if _, err := s.RoomDirName(ctx, "autre", r.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("mauvaise visite : %v", err)
	}
	if _, err := s.RoomDirName(ctx, stateCode, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("pièce inconnue : %v", err)
	}
}

func TestStateListsPhotos(t *testing.T) {
	s := newStateStore(t)
	ctx := context.Background()
	room := mustState(t, s, devA, 0).Rooms[0].ID
	if _, err := s.AddPhoto(ctx, photoRec("ph-room", &room, devA)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddPhoto(ctx, photoRec("ph-global", nil, devB)); err != nil {
		t.Fatal(err)
	}
	got := mustState(t, s, devA, 0).Photos
	if len(got) != 2 {
		t.Fatalf("photos = %+v", got)
	}
	if got[0].ID != "ph-room" || got[0].RoomID == nil || *got[0].RoomID != room || got[0].Author != 1 {
		t.Errorf("photo de pièce = %+v", got[0])
	}
	if got[1].ID != "ph-global" || got[1].RoomID != nil || got[1].Author != 2 {
		t.Errorf("photo globale = %+v", got[1])
	}
	// Les photos sont partagées : B voit les mêmes.
	if n := len(mustState(t, s, devB, 0).Photos); n != 2 {
		t.Errorf("photos vues par B = %d", n)
	}
}

func TestStateIsolatedBetweenVisits(t *testing.T) {
	s := newStateStore(t)
	ctx := context.Background()
	const code2 = "maison-autre"
	if err := s.CreateVisit(ctx, code2, model.Fiche{Address: "2 rue B"}, devC, stateNow); err != nil {
		t.Fatal(err)
	}
	st2, err := s.State(ctx, code2, devC, 0)
	if err != nil {
		t.Fatal(err)
	}
	pt2, room2, q2 := st2.Points[0].ID, st2.Rooms[0].ID, st2.Questions[0].ID
	b := []ops.Op{
		stateOp("x1", ops.TypeSetShared, 1, map[string]any{"target_id": q2, "field": "answer", "value": "secret visite 2"}),
		stateOp("x2", ops.TypeSetRating, 1, map[string]any{"point_id": pt2, "value": 1}),
	}
	if res, _, err := ops.ApplyBatch(ctx, s, code2, devC, b, stateNow); err != nil || res[0].Result != ops.ResultApplied || res[1].Result != ops.ResultApplied {
		t.Fatalf("lot visite 2 : %+v %v", res, err)
	}
	rec := photoRec("ph-v2", &room2, devC)
	rec.VisitCode = code2
	if _, err := s.AddPhoto(ctx, rec); err != nil {
		t.Fatal(err)
	}

	got := mustState(t, s, devA, 0)
	if len(got.Shared) != 0 || len(got.Ratings) != 0 || len(got.Photos) != 0 {
		t.Errorf("fuite entre visites : shared=%v ratings=%v photos=%v", got.Shared, got.Ratings, got.Photos)
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "secret visite 2") || strings.Contains(string(b), room2) {
		t.Error("données de la visite 2 dans l'état de la visite 1")
	}
}

func TestChangesSinceMasksOthersRatings(t *testing.T) {
	s := newStateStore(t)
	st := mustState(t, s, devA, 0)
	pt, room := st.Points[0].ID, st.Rooms[0].ID
	n := mustApply(t, s, devA, stateOp("a1", ops.TypeSetRating, 1, map[string]any{"point_id": pt, "value": 3}))
	mustApply(t, s, devB,
		stateOp("b1", ops.TypeSetRating, 2, map[string]any{"point_id": pt, "value": 1}),
		stateOp("b2", ops.TypeSetComment, 2, map[string]any{"room_id": room, "text": "commentaire de B"}))

	ch := mustState(t, s, devA, n)
	if ch.Seq <= n {
		t.Fatalf("seq = %d, devrait avoir dépassé %d", ch.Seq, n)
	}
	if len(ch.Ratings) != 0 || len(ch.Comments) != 0 {
		t.Errorf("fuite de B dans les changements de A : %+v %+v", ch.Ratings, ch.Comments)
	}
	if b, _ := json.Marshal(ch); strings.Contains(string(b), "commentaire de B") {
		t.Error("commentaire de B dans les changements de A")
	}
}
