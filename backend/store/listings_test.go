package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/mgarnier-home/visite/model"
)

func ptrTo[T any](v T) *T { return &v }

func sampleListing(url string, bedrooms int) model.Listing {
	return model.Listing{
		Source: "bienici", URL: url, Address: "1 rue des Lilas", Notes: "à rappeler",
		VisitAt: ptrTo("2026-11-01T10:00:00Z"), FetchError: "délai dépassé",
		ListingData: model.ListingData{
			Title: "Maison 5 pièces", PropertyType: "Maison", PriceEUR: ptrTo(250000.0),
			LivingAreaM2: ptrTo(118.5), LandAreaM2: ptrTo(400.0), Rooms: ptrTo(5), Bedrooms: &bedrooms,
			Bathrooms: ptrTo(1), ShowerRooms: ptrTo(1), Toilets: ptrTo(2), Parking: ptrTo(2),
			Floor: ptrTo(0), ConstructionYear: ptrTo(1990), DPE: "D", GES: "C", Heating: "gaz",
			City: "Nantes", PostalCode: "44000", Description: "Belle maison", Agency: "Agence X",
			AgentPhone: "0102030405", AgentEmail: "a@x.fr", Features: []string{"garden", "cellar"},
		},
	}
}

func TestCreateListingCreatesVisit(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	tpl, err := s.GetTemplate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	in := sampleListing("https://example.test/a", 2)
	l, err := s.CreateListing(ctx, in, json.RawMessage(`{"id":1}`), testNow)
	if err != nil {
		t.Fatal(err)
	}
	if l.ID == "" || l.CreatedAt != "2026-10-25T10:00:00Z" || l.Status != model.StatusContact {
		t.Fatalf("id, date ou statut non fixés : %+v", l)
	}

	got, err := s.GetListing(ctx, l.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := in
	want.ID, want.CreatedAt, want.Status, want.Photos = l.ID, l.CreatedAt, model.StatusContact, []model.ListingPhoto{}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("GetListing =\n%+v\nveut\n%+v", got, want)
	}
	var raw string
	if err := s.db.QueryRow(`SELECT raw FROM listings WHERE id = ?`, l.ID).Scan(&raw); err != nil || raw != `{"id":1}` {
		t.Errorf("raw = %q, %v", raw, err)
	}

	if _, err := s.Join(ctx, l.ID, "dev-1", testNow); err != nil {
		t.Fatal(err)
	}
	st, err := s.State(ctx, l.ID, "dev-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	wantNames, chambres := 0, 0
	for _, sec := range tpl.Sections {
		if sec.Kind == model.KindPerBedroom {
			wantNames += 2
		} else {
			wantNames++
		}
	}
	for _, r := range st.Rooms {
		if r.Kind == model.KindPerBedroom {
			chambres++
		}
	}
	if len(st.Rooms) != wantNames || chambres != 2 {
		t.Errorf("pièces = %d (dont %d chambres), veut %d dont 2", len(st.Rooms), chambres, wantNames)
	}
	if st.Visit.Code != l.ID || st.Visit.PackingList != tpl.PackingList {
		t.Errorf("visite = %+v", st.Visit)
	}
}

func TestCreateListingDuplicateURL(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	first, err := s.CreateListing(ctx, sampleListing("https://example.test/a", 1), nil, testNow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateListing(ctx, sampleListing("https://example.test/a", 1), nil, testNow); !errors.Is(err, ErrConflict) {
		t.Fatalf("err = %v, veut ErrConflict", err)
	}
	if id, err := s.ListingIDByURL(ctx, "https://example.test/a"); err != nil || id != first.ID {
		t.Errorf("ListingIDByURL = %q, %v, veut %q", id, err, first.ID)
	}
	if _, err := s.ListingIDByURL(ctx, "https://example.test/autre"); !errors.Is(err, ErrNotFound) {
		t.Errorf("URL inconnue : %v", err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM visits`).Scan(&n); err != nil || n != 1 {
		t.Errorf("visites = %d, %v : la création refusée ne doit rien laisser", n, err)
	}
}

func TestListListingsNewestFirst(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	old, _ := s.CreateListing(ctx, sampleListing("https://example.test/old", 0), nil, testNow)
	recent, _ := s.CreateListing(ctx, sampleListing("https://example.test/new", 0), nil, testNow.Add(time.Hour))
	if _, err := s.AddListingPhoto(ctx, old.ID, "https://img/1", "listings/x/1.jpg", 10); err != nil {
		t.Fatal(err)
	}
	got, err := s.ListListings(ctx)
	if err != nil || len(got) != 2 || got[0].ID != recent.ID || got[1].ID != old.ID {
		t.Fatalf("ListListings = %+v, %v", got, err)
	}
	if len(got[1].Photos) != 1 || len(got[0].Photos) != 0 {
		t.Errorf("photos = %v / %v", got[1].Photos, got[0].Photos)
	}
	if _, err := s.GetListing(ctx, "inconnue"); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetListing inconnue : %v", err)
	}
}

func TestDeleteListingRemovesEverything(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	l, err := s.CreateListing(ctx, sampleListing("https://example.test/a", 1), nil, testNow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, l.ID, "dev-1", testNow); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddListingPhoto(ctx, l.ID, "https://img/1", "listings/"+l.ID+"/1.jpg", 10); err != nil {
		t.Fatal(err)
	}
	var roomID, pointID string
	if err := s.db.QueryRow(`SELECT r.id, p.id FROM visit_rooms r JOIN visit_points p ON p.room_id = r.id
		WHERE r.visit_code = ? AND r.kind = 'room' LIMIT 1`, l.ID).Scan(&roomID, &pointID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, s.db, `INSERT INTO ratings (point_id, device_id, value, updated_at, seq) VALUES (?, 'dev-1', 3, 1, 2)`, pointID)
	mustExec(t, s.db, `INSERT INTO shared_values (target_id, field, value, updated_at, device_id, seq) VALUES (?, 'works_eur', '100', 1, 'dev-1', 2)`, pointID)
	mustExec(t, s.db, `INSERT INTO shared_values (target_id, field, value, updated_at, device_id, seq) VALUES (?, 'notes', '"x"', 1, 'dev-1', 2)`, roomID)
	mustExec(t, s.db, `INSERT INTO photos (id, visit_code, room_id, device_id, taken_at, path, size, seq) VALUES ('ph', ?, ?, 'dev-1', 't', 'p', 1, 2)`, l.ID, roomID)
	mustExec(t, s.db, `INSERT INTO ops (op_id, visit_code, device_id, type, payload, client_ts, received_at, result) VALUES ('op1', ?, 'dev-1', 'x', '{}', 1, 1, 'applied')`, l.ID)

	if err := s.DeleteListing(ctx, l.ID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"listings", "listing_photos", "visits", "participants", "visit_rooms",
		"visit_points", "visit_questions", "ratings", "shared_values", "ops", "photos"} {
		if n := count(t, s.db, table); n != 0 {
			t.Errorf("%s : %d ligne(s) restante(s)", table, n)
		}
	}
	if err := s.DeleteListing(ctx, l.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("seconde suppression : %v", err)
	}
}

func TestOpenRefusesV1Database(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
	mustExec(t, db, `INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('003_important.sql')`)
	db.Close()
	if _, err := Open(path); !errors.Is(err, ErrV1Database) {
		t.Fatalf("err = %v, veut ErrV1Database", err)
	}
}

func TestAddListingPhoto(t *testing.T) {
	ctx := context.Background()
	s := seededStore(t)
	l, err := s.CreateListing(ctx, sampleListing("https://example.test/a", 0), nil, testNow)
	if err != nil {
		t.Fatal(err)
	}
	id0, err := s.AddListingPhoto(ctx, l.ID, "https://img/0", "listings/a/0.jpg", 10)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddListingPhoto(ctx, l.ID, "https://img/1", "listings/a/1.jpg", 20); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddListingPhoto(ctx, l.ID, "https://img/0", "listings/a/2.jpg", 30); !errors.Is(err, ErrConflict) {
		t.Fatalf("même source : err = %v, veut ErrConflict", err)
	}
	got, err := s.GetListing(ctx, l.ID)
	if err != nil || len(got.Photos) != 2 || got.Photos[0].ID != id0 || got.Photos[0].Position != 0 || got.Photos[1].Position != 1 {
		t.Fatalf("photos = %+v, %v", got.Photos, err)
	}
	urls, err := s.ListingPhotoURLs(ctx, l.ID)
	if err != nil || !reflect.DeepEqual(urls, map[string]bool{"https://img/0": true, "https://img/1": true}) {
		t.Errorf("ListingPhotoURLs = %v, %v", urls, err)
	}
	if p, err := s.ListingPhotoPath(ctx, l.ID, id0); err != nil || p != "listings/a/0.jpg" {
		t.Errorf("ListingPhotoPath = %q, %v", p, err)
	}
	if _, err := s.ListingPhotoPath(ctx, "autre", id0); !errors.Is(err, ErrNotFound) {
		t.Errorf("autre annonce : %v", err)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatalf("%s : %v", q, err)
	}
}

func count(t *testing.T, db *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
