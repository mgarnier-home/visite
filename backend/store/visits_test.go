package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
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

// mustCreate crée une annonce (URL tirée du nom) avec n chambres et inscrit l'appareil ;
// renvoie son id, qui est le code de la visite.
func mustCreate(t *testing.T, s *Store, name string, bedrooms *int, device string) string {
	t.Helper()
	l, err := s.CreateListing(context.Background(), model.Listing{
		Source: "manual", URL: "https://example.test/" + name, ListingData: model.ListingData{Bedrooms: bedrooms},
	}, nil, testNow)
	if err != nil {
		t.Fatalf("CreateListing(%s): %v", name, err)
	}
	if _, err := s.Join(context.Background(), l.ID, device, testNow); err != nil {
		t.Fatalf("Join: %v", err)
	}
	return l.ID
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
	tpl, err := s.GetTemplate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	three := 3
	id := mustCreate(t, s, "maison", &three, "dev-1")

	rooms := listRooms(t, s, id)
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
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM visit_questions WHERE room_id = ?`, cuisine.id).Scan(&nq); err != nil {
			t.Fatal(err)
		}
		if nq != len(sec.Questions) {
			t.Errorf("cuisine: %d questions, veut %d", nq, len(sec.Questions))
		}
	}

	var packing, created string
	var seq int64
	if err := s.db.QueryRow(`SELECT packing_list, created_at, seq FROM visits WHERE code = ?`, id).
		Scan(&packing, &created, &seq); err != nil {
		t.Fatal(err)
	}
	if packing != tpl.PackingList || packing == "" {
		t.Errorf("packing_list non copié: %q", packing)
	}
	if seq != 1 || created != "2026-10-25T10:00:00Z" {
		t.Errorf("seq=%d created_at=%q", seq, created)
	}
}

func TestCreateVisitWithoutBedrooms(t *testing.T) {
	zero := 0
	for name, n := range map[string]*int{"nil": nil, "zero": &zero} {
		t.Run(name, func(t *testing.T) {
			s := seededStore(t)
			id := mustCreate(t, s, "maison", n, "dev-1")
			for _, r := range listRooms(t, s, id) {
				if r.kind == "per_bedroom" {
					t.Errorf("chambre inattendue: %+v", r)
				}
			}
		})
	}
}

func TestJoinNumbersInOrder(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	id := mustCreate(t, s, "maison-6", nil, "dev-1")
	for i, dev := range []string{"dev-2", "dev-3"} {
		n, err := s.Join(ctx, id, dev, testNow)
		if err != nil || n != i+2 {
			t.Fatalf("Join(%s) = %d, %v, veut %d", dev, n, err, i+2)
		}
	}
}

func TestJoinIsIdempotent(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	id := mustCreate(t, s, "maison-7", nil, "dev-1")
	a, err := s.Join(ctx, id, "dev-2", testNow)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Join(ctx, id, "dev-2", testNow.Add(time.Hour))
	if err != nil || a != b {
		t.Fatalf("Join deux fois = %d puis %d, %v", a, b, err)
	}
	c, err := s.Join(ctx, id, "dev-1", testNow)
	if err != nil || c != 1 {
		t.Errorf("le créateur rejoint = %d, veut 1", c)
	}
	if n, err := s.Join(ctx, id, "dev-3", testNow); err != nil || n != 3 {
		t.Errorf("troisième appareil = %d, %v, veut 3", n, err)
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
	id := mustCreate(t, s, "maison-8", nil, "dev-1")
	count := func() int {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id
			WHERE r.visit_code = ?`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()

	tpl, err := s.GetTemplate(ctx)
	if err != nil {
		t.Fatal(err)
	}
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
	if err := s.db.QueryRow(`SELECT packing_list FROM visits WHERE code = ?`, id).Scan(&packing); err != nil {
		t.Fatal(err)
	}
	if packing == "autre" {
		t.Error("packing_list de la visite modifié par le modèle")
	}
}

func TestJoinConcurrentDistinctNumbers(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	id := mustCreate(t, s, "course-join", nil, "dev-0")
	const n = 10
	nums := make([]int, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			nums[i], errs[i] = s.Join(ctx, id, fmt.Sprintf("dev-%d", i+1), testNow)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("Join: %v", err)
		}
	}
	sort.Ints(nums)
	for i, got := range nums {
		if got != i+2 {
			t.Fatalf("numéros = %v, veut 2..%d", nums, n+1)
		}
	}
}

// sectionIDByName renvoie l'identifiant de la section du modèle portant ce nom.
func sectionIDByName(t *testing.T, tpl model.Template, name string) string {
	t.Helper()
	for _, sec := range tpl.Sections {
		if sec.Name == name {
			return sec.ID
		}
	}
	t.Fatalf("section %q absente du modèle", name)
	return ""
}

func roomNames(rooms []roomRow) []string {
	out := []string{}
	for _, r := range rooms {
		out = append(out, r.name)
	}
	return out
}

func listQuestionTexts(t *testing.T, s *Store, roomID string) []string {
	t.Helper()
	rows, err := s.db.Query(`SELECT text FROM visit_questions WHERE room_id = ? ORDER BY position`, roomID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var q string
		if err := rows.Scan(&q); err != nil {
			t.Fatal(err)
		}
		out = append(out, q)
	}
	return out
}

// Chaque point et chaque question copiés gardent l'indicateur « importante » du modèle ; la note
// globale ajoutée à chaque pièce est importante.
func TestCreateVisitCopiesImportance(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	tpl, err := s.GetTemplate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id := mustCreate(t, s, "maison-1", nil, "dev-1")
	points := map[string]bool{"Note globale de la pièce": true} // libellé → important
	questions := map[string]bool{}                              // texte → importante
	for _, sec := range tpl.Sections {
		for _, p := range sec.Points {
			if w, dup := points[p.Label]; dup && w != p.Important {
				t.Fatalf("libellé %q en double avec deux indicateurs différents", p.Label)
			}
			points[p.Label] = p.Important
		}
		for _, q := range sec.Questions {
			questions[q.Text] = q.Important
		}
	}
	check := func(what string, want map[string]bool, query string, args ...any) {
		t.Helper()
		rows, err := s.db.Query(query, args...)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		important, secondary := 0, 0
		for rows.Next() {
			var text string
			var imp bool
			if err := rows.Scan(&text, &imp); err != nil {
				t.Fatal(err)
			}
			if w, ok := want[text]; !ok || w != imp {
				t.Errorf("%s %q : important = %v, veut %v (connu : %v)", what, text, imp, w, ok)
			}
			if imp {
				important++
			} else {
				secondary++
			}
		}
		if important == 0 || secondary == 0 {
			t.Errorf("%s : %d importants, %d secondaires : la seed doit fournir les deux", what, important, secondary)
		}
	}
	check("point", points, `SELECT p.label, p.important FROM visit_points p
		JOIN visit_rooms r ON r.id = p.room_id WHERE r.visit_code = ?`, id)
	check("question", questions, `SELECT q.text, q.important FROM visit_questions q
		JOIN visit_rooms r ON r.id = q.room_id WHERE r.visit_code = ?`, id)
}
