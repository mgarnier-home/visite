package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/seed"
)

var testNow = time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)

func seededStore(t *testing.T) *Store {
	t.Helper()
	s := newTestStore(t)
	tpl, err := seed.Template()
	if err != nil {
		t.Fatalf("seed.Template: %v", err)
	}
	if err := s.SeedTemplateIfEmpty(context.Background(), tpl); err != nil {
		t.Fatalf("SeedTemplateIfEmpty: %v", err)
	}
	return s
}

func ficheWithBedrooms(n *int) model.Fiche {
	return model.Fiche{Address: "1 rue des Lilas", BedroomsCount: n}
}

type roomRow struct {
	id, name, dirName, kind string
	position                int
	seq                     int64
}

func listRooms(t *testing.T, s *Store, code string) []roomRow {
	t.Helper()
	rows, err := s.db.Query(`SELECT id, name, dir_name, kind, position, seq FROM visit_rooms
		WHERE visit_code = ? ORDER BY position`, code)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []roomRow{}
	for rows.Next() {
		var r roomRow
		if err := rows.Scan(&r.id, &r.name, &r.dirName, &r.kind, &r.position, &r.seq); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

type pointRow struct {
	label, typ, options string
	weight              float64
	position            int
}

func listPoints(t *testing.T, s *Store, roomID string) []pointRow {
	t.Helper()
	rows, err := s.db.Query(`SELECT label, type, options, weight, position FROM visit_points
		WHERE room_id = ? ORDER BY position`, roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []pointRow{}
	for rows.Next() {
		var p pointRow
		if err := rows.Scan(&p.label, &p.typ, &p.options, &p.weight, &p.position); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	return out
}

func TestCreateVisitCopiesTemplate(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	tpl, _ := s.GetTemplate(ctx)
	three := 3
	if err := s.CreateVisit(ctx, "maison-1", ficheWithBedrooms(&three), "dev-1", testNow); err != nil {
		t.Fatalf("CreateVisit: %v", err)
	}

	rooms := listRooms(t, s, "maison-1")
	wantNames := []string{}
	for _, sec := range tpl.Sections {
		if sec.Kind == model.KindPerBedroom {
			wantNames = append(wantNames, "Chambre 1", "Chambre 2", "Chambre 3")
		} else {
			wantNames = append(wantNames, sec.Name)
		}
	}
	if len(rooms) != len(wantNames) {
		t.Fatalf("pièces = %d, veut %d", len(rooms), len(wantNames))
	}
	dirs := map[string]bool{}
	for i, r := range rooms {
		if r.name != wantNames[i] || r.position != i || r.seq != 1 {
			t.Errorf("pièce %d = %+v, veut nom %q", i, r, wantNames[i])
		}
		dirs[r.dirName] = true
	}
	for _, d := range []string{"chambre-1", "chambre-2", "chambre-3", "cuisine"} {
		if !dirs[d] {
			t.Errorf("dir_name %q absent (%v)", d, dirs)
		}
	}

	for _, r := range rooms {
		pts := listPoints(t, s, r.id)
		hasNote := len(pts) > 0 && pts[0].label == "Note globale de la pièce"
		switch r.kind {
		case "room", "per_bedroom":
			if !hasNote || pts[0].typ != "note" || pts[0].weight != 1 || pts[0].options != "[]" || pts[0].position != 0 {
				t.Errorf("%s: note globale manquante ou fausse: %+v", r.name, pts)
			}
		default:
			if hasNote {
				t.Errorf("%s: ne doit pas avoir de note globale", r.name)
			}
		}
	}

	// Points copiés après la note globale, dans l'ordre du modèle.
	for _, sec := range tpl.Sections {
		if sec.Name != "Cuisine" {
			continue
		}
		var cuisine roomRow
		for _, r := range rooms {
			if r.dirName == "cuisine" {
				cuisine = r
			}
		}
		pts := listPoints(t, s, cuisine.id)
		if len(pts) != len(sec.Points)+1 {
			t.Fatalf("cuisine: %d points, veut %d", len(pts), len(sec.Points)+1)
		}
		for i, p := range sec.Points {
			if pts[i+1].label != p.Label || pts[i+1].position != i+1 {
				t.Errorf("cuisine point %d = %+v, veut %q", i, pts[i+1], p.Label)
			}
		}
		var nq int
		s.db.QueryRow(`SELECT COUNT(*) FROM visit_questions WHERE room_id = ?`, cuisine.id).Scan(&nq)
		if nq != len(sec.Questions) {
			t.Errorf("cuisine: %d questions, veut %d", nq, len(sec.Questions))
		}
	}

	var packing, ficheTS, created string
	var seq int64
	if err := s.db.QueryRow(`SELECT packing_list, fiche_ts, created_at, seq FROM visits WHERE code = ?`, "maison-1").
		Scan(&packing, &ficheTS, &created, &seq); err != nil {
		t.Fatal(err)
	}
	if packing != tpl.PackingList || packing == "" {
		t.Errorf("packing_list non copié: %q", packing)
	}
	if ficheTS != "{}" || seq != 1 || created != "2026-10-25T10:00:00Z" {
		t.Errorf("fiche_ts=%q seq=%d created_at=%q", ficheTS, seq, created)
	}
	var addr string
	var bed int
	s.db.QueryRow(`SELECT address, bedrooms_count FROM visits WHERE code = ?`, "maison-1").Scan(&addr, &bed)
	if addr != "1 rue des Lilas" || bed != 3 {
		t.Errorf("fiche non persistée: %q %d", addr, bed)
	}
}

func TestCreateVisitWithoutBedrooms(t *testing.T) {
	ctx := context.Background()
	zero := 0
	for name, n := range map[string]*int{"nil": nil, "zero": &zero} {
		t.Run(name, func(t *testing.T) {
			s := seededStore(t)
			if err := s.CreateVisit(ctx, "maison-2", ficheWithBedrooms(n), "dev-1", testNow); err != nil {
				t.Fatal(err)
			}
			for _, r := range listRooms(t, s, "maison-2") {
				if r.kind == "per_bedroom" {
					t.Errorf("chambre inattendue: %+v", r)
				}
			}
		})
	}
}

func TestCreateVisitRejectsTakenCode(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	if err := s.CreateVisit(ctx, "maison-3", ficheWithBedrooms(nil), "dev-1", testNow); err != nil {
		t.Fatal(err)
	}
	err := s.CreateVisit(ctx, "maison-3", ficheWithBedrooms(nil), "dev-2", testNow)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("err = %v, veut ErrConflict", err)
	}
	ok, err := s.VisitExists(ctx, "maison-3")
	if err != nil || !ok {
		t.Errorf("VisitExists = %v, %v", ok, err)
	}
	ok, err = s.VisitExists(ctx, "autre-code")
	if err != nil || ok {
		t.Errorf("VisitExists(inconnu) = %v, %v", ok, err)
	}
}

func TestCreateVisitRejectsBadCode(t *testing.T) {
	s := seededStore(t)
	err := s.CreateVisit(context.Background(), "A!", ficheWithBedrooms(nil), "dev-1", testNow)
	if !errors.Is(err, model.ErrInvalid) {
		t.Fatalf("err = %v, veut ErrInvalid", err)
	}
	err = s.CreateVisit(context.Background(), "maison-4", model.Fiche{}, "dev-1", testNow)
	if !errors.Is(err, model.ErrInvalid) {
		t.Fatalf("fiche sans adresse: err = %v, veut ErrInvalid", err)
	}
}

func TestCreatorIsParticipantOne(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	if err := s.CreateVisit(ctx, "maison-5", ficheWithBedrooms(nil), "dev-1", testNow); err != nil {
		t.Fatal(err)
	}
	n, err := s.ParticipantNumber(ctx, "maison-5", "dev-1")
	if err != nil || n != 1 {
		t.Fatalf("ParticipantNumber = %d, %v", n, err)
	}
	if _, err := s.ParticipantNumber(ctx, "maison-5", "inconnu"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non participant: err = %v, veut ErrNotFound", err)
	}
}

func TestJoinNumbersInOrder(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	s.CreateVisit(ctx, "maison-6", ficheWithBedrooms(nil), "dev-1", testNow)
	for i, dev := range []string{"dev-2", "dev-3"} {
		n, err := s.Join(ctx, "maison-6", dev, testNow)
		if err != nil || n != i+2 {
			t.Fatalf("Join(%s) = %d, %v, veut %d", dev, n, err, i+2)
		}
	}
}

func TestJoinIsIdempotent(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	s.CreateVisit(ctx, "maison-7", ficheWithBedrooms(nil), "dev-1", testNow)
	a, err := s.Join(ctx, "maison-7", "dev-2", testNow)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Join(ctx, "maison-7", "dev-2", testNow.Add(time.Hour))
	if err != nil || a != b {
		t.Fatalf("Join deux fois = %d puis %d, %v", a, b, err)
	}
	c, _ := s.Join(ctx, "maison-7", "dev-1", testNow)
	if c != 1 {
		t.Errorf("le créateur rejoint = %d, veut 1", c)
	}
	if n, _ := s.Join(ctx, "maison-7", "dev-3", testNow); n != 3 {
		t.Errorf("troisième appareil = %d, veut 3", n)
	}
}

func TestJoinUnknownVisit(t *testing.T) {
	s := seededStore(t)
	if _, err := s.Join(context.Background(), "nulle-part", "dev-1", testNow); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, veut ErrNotFound", err)
	}
}

func TestTemplateChangeDoesNotAffectVisit(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	s.CreateVisit(ctx, "maison-8", ficheWithBedrooms(nil), "dev-1", testNow)
	count := func() int {
		var n int
		s.db.QueryRow(`SELECT COUNT(*) FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id
			WHERE r.visit_code = ?`, "maison-8").Scan(&n)
		return n
	}
	before := count()

	tpl, _ := s.GetTemplate(ctx)
	tpl.Sections = tpl.Sections[:1]
	tpl.Sections[0].Points = []model.TemplatePoint{}
	tpl.Sections[0].Questions = []model.TemplateQuestion{}
	tpl.PackingList = "autre"
	if _, err := s.SaveTemplate(ctx, tpl); err != nil {
		t.Fatal(err)
	}
	if after := count(); after != before || before == 0 {
		t.Errorf("points visite: %d avant, %d après", before, after)
	}
	var packing string
	s.db.QueryRow(`SELECT packing_list FROM visits WHERE code = ?`, "maison-8").Scan(&packing)
	if packing == "autre" {
		t.Error("packing_list de la visite modifié par le modèle")
	}
}
