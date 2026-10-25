package ops_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/ops"
	"github.com/mgarnier-home/visite/seed"
	"github.com/mgarnier-home/visite/store"
)

const (
	devA = "aaaaaaaa-0000-4000-8000-000000000001" // créateur
	devB = "bbbbbbbb-0000-4000-8000-000000000002" // participant
)

var testNow = time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)

type env struct {
	t    *testing.T
	s    *store.Store
	db   *sql.DB // lecture directe pour les vérifications
	code string
}

// newEnv crée une visite avec la seed (3 chambres) : A créateur, B participant.
func newEnv(t *testing.T) *env {
	t.Helper()
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := store.Open(path)
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
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := &env{t: t, s: s, db: db, code: "maison-test"}
	e.createVisit(e.code)
	if _, err := s.Join(ctx, e.code, devB, testNow); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e *env) createVisit(code string) {
	e.t.Helper()
	three := 3
	f := model.Fiche{Address: "1 rue des Lilas", BedroomsCount: &three}
	if err := e.s.CreateVisit(context.Background(), code, f, devA, testNow); err != nil {
		e.t.Fatalf("CreateVisit(%s): %v", code, err)
	}
}

func (e *env) apply(device string, batch ...ops.Op) ([]ops.Result, int64) {
	e.t.Helper()
	res, seq, err := ops.ApplyBatch(context.Background(), e.s, e.code, device, batch, testNow)
	if err != nil {
		e.t.Fatalf("ApplyBatch: %v", err)
	}
	if len(res) != len(batch) {
		e.t.Fatalf("%d résultats pour %d opérations", len(res), len(batch))
	}
	return res, seq
}

// applyOne applique une seule opération et renvoie « result » ou « rejected/reason ».
func (e *env) applyOne(device string, op ops.Op) string {
	e.t.Helper()
	res, _ := e.apply(device, op)
	return outcome(res[0])
}

func outcome(r ops.Result) string {
	if r.Reason != "" {
		return r.Result + "/" + r.Reason
	}
	return r.Result
}

func op(typ string, ts int64, payload any) ops.Op {
	b, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return ops.Op{OpID: uuid.NewString(), Type: typ, ClientTS: ts, Payload: b}
}

func (e *env) queryString(q string, args ...any) string {
	e.t.Helper()
	var s string
	if err := e.db.QueryRow(q, args...).Scan(&s); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
	return s
}

func (e *env) queryInt(q string, args ...any) int64 {
	e.t.Helper()
	var n int64
	if err := e.db.QueryRow(q, args...).Scan(&n); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
	return n
}

// pointOfType renvoie l'id d'un point de la visite du type donné.
func (e *env) pointOfType(code, typ string) string {
	return e.queryString(`SELECT p.id FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id
		WHERE r.visit_code = ? AND p.type = ? ORDER BY r.position, p.position LIMIT 1`, code, typ)
}

func (e *env) roomByDir(dir string) string {
	return e.queryString(`SELECT id FROM visit_rooms WHERE visit_code = ? AND dir_name = ?`, e.code, dir)
}

func (e *env) question() string {
	return e.queryString(`SELECT q.id FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id
		WHERE r.visit_code = ? ORDER BY r.position, q.position LIMIT 1`, e.code)
}

func (e *env) visitSeq() int64 {
	return e.queryInt(`SELECT seq FROM visits WHERE code = ?`, e.code)
}

func TestWins(t *testing.T) {
	cases := []struct {
		name      string
		storedTS  int64
		storedDev string
		opTS      int64
		opDev     string
		want      bool
	}{
		{"plus récent gagne", 100, "b", 200, "a", true},
		{"plus ancien perd", 200, "a", 100, "b", false},
		{"égalité, plus grand device gagne", 100, "a", 100, "b", true},
		{"égalité, plus petit device perd", 100, "b", 100, "a", false},
		{"égalité totale perd", 100, "a", 100, "a", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ops.Wins(c.storedTS, c.storedDev, c.opTS, c.opDev); got != c.want {
				t.Errorf("Wins(%d, %q, %d, %q) = %v, veut %v", c.storedTS, c.storedDev, c.opTS, c.opDev, got, c.want)
			}
		})
	}
}

func TestDuplicateOpIgnored(t *testing.T) {
	e := newEnv(t)
	o := op("set_comment", 100, map[string]any{"room_id": e.roomByDir("cuisine"), "text": "humide"})
	res, _ := e.apply(devB, o, o)
	if outcome(res[0]) != "applied" || outcome(res[1]) != "duplicate" {
		t.Fatalf("résultats = %+v", res)
	}
	if got := e.applyOne(devB, o); got != "duplicate" {
		t.Errorf("nouvel envoi = %s, veut duplicate", got)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM ops WHERE op_id = ?`, o.OpID); n != 1 {
		t.Errorf("%d lignes dans ops, veut 1", n)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM room_comments`); n != 1 {
		t.Errorf("%d commentaires, veut 1", n)
	}
}

func TestRejectedOpRecorded(t *testing.T) {
	e := newEnv(t)
	o := op("set_fiche", 100, map[string]any{"fields": map[string]any{"address": "x"}})
	if got := e.applyOne(devB, o); got != "rejected/forbidden" {
		t.Fatalf("premier envoi = %s", got)
	}
	if got := e.applyOne(devB, o); got != "duplicate" {
		t.Errorf("nouvel envoi d'une opération refusée = %s, veut duplicate", got)
	}
	if r := e.queryString(`SELECT result FROM ops WHERE op_id = ?`, o.OpID); r != "rejected:forbidden" {
		t.Errorf("journal = %q", r)
	}
}

func TestConcurrentDuplicateBatch(t *testing.T) {
	e := newEnv(t)
	batch := []ops.Op{
		op("set_comment", 100, map[string]any{"room_id": e.roomByDir("cuisine"), "text": "a"}),
		op("set_rating", 100, map[string]any{"point_id": e.pointOfType(e.code, "note"), "value": 4}),
		op("add_room", 100, map[string]any{"id": uuid.NewString(), "name": "Véranda", "from_section_id": nil}),
		op("set_rating", 100, map[string]any{"point_id": "inconnu", "value": 4}),
	}
	const n = 2
	results := make([][]ops.Result, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _, errs[i] = ops.ApplyBatch(context.Background(), e.s, e.code, devB, batch, testNow)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("ApplyBatch: %v", err)
		}
	}
	for j, o := range batch {
		counts := map[string]int{}
		for i := range n {
			counts[results[i][j].Result]++
		}
		first := "applied"
		if j == 3 {
			first = "rejected"
		}
		if counts[first] != 1 || counts["duplicate"] != 1 {
			t.Errorf("op %d (%s) : résultats %v, veut un %s et un duplicate", j, o.Type, counts, first)
		}
	}
	if c := e.queryInt(`SELECT COUNT(*) FROM visit_rooms WHERE visit_code = ? AND name = 'Véranda'`, e.code); c != 1 {
		t.Errorf("%d vérandas, veut 1", c)
	}
}

func TestSharedLastWriteWins(t *testing.T) {
	e := newEnv(t)
	q := e.question()
	res, _ := e.apply(devB, op("set_shared", 200, map[string]any{"target_id": q, "field": "answer", "value": "de B"}))
	resA, _ := e.apply(devA, op("set_shared", 100, map[string]any{"target_id": q, "field": "answer", "value": "de A"}))
	if outcome(res[0]) != "applied" || outcome(resA[0]) != "applied" {
		t.Fatalf("résultats = %+v %+v", res, resA)
	}
	v := e.queryString(`SELECT value FROM shared_values WHERE target_id = ? AND field = 'answer'`, q)
	dev := e.queryString(`SELECT device_id FROM shared_values WHERE target_id = ? AND field = 'answer'`, q)
	if v != `"de B"` || dev != devB {
		t.Errorf("valeur = %s par %s, veut \"de B\" par B", v, dev)
	}

	// À horodatage égal, le plus grand device_id l'emporte (B > A).
	e.apply(devA, op("set_shared", 200, map[string]any{"target_id": q, "field": "answer", "value": "A égal"}))
	if v := e.queryString(`SELECT value FROM shared_values WHERE target_id = ? AND field = 'answer'`, q); v != `"de B"` {
		t.Errorf("égalité : valeur = %s, veut celle de B", v)
	}
	e.apply(devA, op("set_shared", 201, map[string]any{"target_id": q, "field": "answer", "value": "A récent"}))
	if v := e.queryString(`SELECT value FROM shared_values WHERE target_id = ? AND field = 'answer'`, q); v != `"A récent"` {
		t.Errorf("plus récent : valeur = %s", v)
	}
}

func TestSharedEqualTimestamp(t *testing.T) {
	e := newEnv(t)
	q := e.question()
	e.apply(devA, op("set_shared", 300, map[string]any{"target_id": q, "field": "answer", "value": "de A"}))
	before := e.visitSeq()
	// Même horodatage, B > A : l'écriture de B l'emporte et incrémente seq.
	res, seq := e.apply(devB, op("set_shared", 300, map[string]any{"target_id": q, "field": "answer", "value": "de B"}))
	if outcome(res[0]) != "applied" || seq != before+1 {
		t.Fatalf("B à égalité : %+v, seq %d, veut %d", res, seq, before+1)
	}
	v := e.queryString(`SELECT value FROM shared_values WHERE target_id = ? AND field = 'answer'`, q)
	if dev := e.queryString(`SELECT device_id FROM shared_values WHERE target_id = ? AND field = 'answer'`, q); v != `"de B"` || dev != devB {
		t.Errorf("valeur = %s par %s, veut \"de B\" par B", v, dev)
	}
	if s := e.queryInt(`SELECT seq FROM shared_values WHERE target_id = ? AND field = 'answer'`, q); s != seq {
		t.Errorf("seq de la valeur = %d, veut %d", s, seq)
	}
}

func TestSharedLosingWriteKeepsSeq(t *testing.T) {
	e := newEnv(t)
	q := e.question()
	_, before := e.apply(devB, op("set_shared", 200, map[string]any{"target_id": q, "field": "asked", "value": true}))
	res, seq := e.apply(devA, op("set_shared", 100, map[string]any{"target_id": q, "field": "asked", "value": false}))
	if outcome(res[0]) != "applied" || seq != before {
		t.Errorf("écriture perdante : %+v, seq %d, veut %d inchangé", res, seq, before)
	}
	if v := e.queryString(`SELECT value FROM shared_values WHERE target_id = ? AND field = 'asked'`, q); v != "true" {
		t.Errorf("valeur = %s, veut true", v)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM ops WHERE device_id = ?`, devA); n != 1 {
		t.Errorf("%d ops journalisées pour A, veut 1", n)
	}
}

func TestSharedTargets(t *testing.T) {
	e := newEnv(t)
	casePt := e.pointOfType(e.code, "case")
	constat := e.pointOfType(e.code, "constat")
	room := e.roomByDir("cuisine")
	cases := []struct {
		target, field string
		value         any
		want          string
	}{
		{casePt, "value", "problem", "applied"},
		{casePt, "value", "bof", "rejected/invalid"},
		{constat, "value", "na", "applied"},
		{casePt, "blocking", true, "applied"},
		{casePt, "works_eur", 1500, "applied"},
		{casePt, "works_eur", -1, "rejected/invalid"},
		{e.question(), "asked", true, "applied"},
		{room, "area_m2", 12.5, "applied"},
		{room, "answer", "x", "rejected/invalid"},
		{room, "area_m2", nil, "rejected/invalid"},
		{"inconnu", "area_m2", 3, "rejected/not_found"},
	}
	for _, c := range cases {
		got := e.applyOne(devB, op("set_shared", 100, map[string]any{"target_id": c.target, "field": c.field, "value": c.value}))
		if got != c.want {
			t.Errorf("set_shared %s=%v : %s, veut %s", c.field, c.value, got, c.want)
		}
	}
}

func TestRatingOnlyOnNote(t *testing.T) {
	e := newEnv(t)
	note := e.pointOfType(e.code, "note")
	cases := []struct {
		point string
		value any
		want  string
	}{
		{e.pointOfType(e.code, "case"), 3, "rejected/invalid"},
		{note, 6, "rejected/invalid"},
		{note, 0, "rejected/invalid"},
		{note, 2.5, "rejected/invalid"},
		{note, nil, "applied"},
		{note, 5, "applied"},
	}
	for i, c := range cases {
		if got := e.applyOne(devB, op("set_rating", int64(100+i), map[string]any{"point_id": c.point, "value": c.value})); got != c.want {
			t.Errorf("note %v : %s, veut %s", c.value, got, c.want)
		}
	}
	if got := e.applyOne(devB, op("set_rating", 1, map[string]any{"point_id": note})); got != "rejected/invalid" {
		t.Errorf("value absente : %s, veut rejected/invalid", got)
	}
	if v := e.queryInt(`SELECT value FROM ratings WHERE point_id = ? AND device_id = ?`, note, devB); v != 5 {
		t.Errorf("note stockée = %d, veut 5", v)
	}
}

func TestRatingsArePerDevice(t *testing.T) {
	e := newEnv(t)
	note := e.pointOfType(e.code, "note")
	e.apply(devB, op("set_rating", 200, map[string]any{"point_id": note, "value": 2}))
	if got := e.applyOne(devA, op("set_rating", 100, map[string]any{"point_id": note, "value": 4})); got != "applied" {
		t.Fatalf("A : %s", got)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM ratings WHERE point_id = ?`, note); n != 2 {
		t.Errorf("%d notes, veut une par appareil", n)
	}
	if v := e.queryInt(`SELECT value FROM ratings WHERE point_id = ? AND device_id = ?`, note, devA); v != 4 {
		t.Errorf("note de A = %d, veut 4", v)
	}
}

func TestFicheOnlyCreator(t *testing.T) {
	e := newEnv(t)
	fields := map[string]any{"fields": map[string]any{"price_eur": 250000}}
	if got := e.applyOne(devB, op("set_fiche", 100, fields)); got != "rejected/forbidden" {
		t.Errorf("B : %s, veut rejected/forbidden", got)
	}
	if got := e.applyOne(devA, op("set_fiche", 100, fields)); got != "applied" {
		t.Errorf("A : %s, veut applied", got)
	}
	if p := e.queryInt(`SELECT CAST(price_eur AS INTEGER) FROM visits WHERE code = ?`, e.code); p != 250000 {
		t.Errorf("prix = %d", p)
	}
}

func TestFicheFields(t *testing.T) {
	e := newEnv(t)
	all := map[string]any{
		"address": "2 rue du Port", "price_eur": 300000.5, "living_area_m2": 110, "floor_area_m2": 120,
		"land_area_m2": 500, "visit_at": "2026-10-25T14:00:00+02:00", "agent_name": "Mme X",
		"agent_phone": "0600000000", "agent_email": "x@example.com", "construction_year": 1975,
		"dpe_energy": "D", "dpe_ges": "E", "rooms_count": 6, "bedrooms_count": 3,
		"listing_url": "https://example.com/annonce", "heating_type": "gaz",
	}
	if got := e.applyOne(devA, op("set_fiche", 100, map[string]any{"fields": all})); got != "applied" {
		t.Fatalf("tous les champs : %s", got)
	}
	var got model.Fiche
	if err := e.s.InTx(context.Background(), func(tx *store.Tx) error {
		v, err := tx.Visit(e.code)
		got = v.Fiche
		return err
	}); err != nil {
		t.Fatal(err)
	}
	gb, _ := json.Marshal(got)
	var gm map[string]any
	if err := json.Unmarshal(gb, &gm); err != nil {
		t.Fatal(err)
	}
	wb, _ := json.Marshal(all)
	var wm map[string]any
	if err := json.Unmarshal(wb, &wm); err != nil {
		t.Fatal(err)
	}
	for k, w := range wm {
		if fmt.Sprint(gm[k]) != fmt.Sprint(w) {
			t.Errorf("%s = %v, veut %v", k, gm[k], w)
		}
	}
	if seqChanged, seq := e.queryInt(`SELECT seq_changed FROM visits WHERE code = ?`, e.code), e.visitSeq(); seqChanged != seq || seq != 2 {
		t.Errorf("seq_changed = %d, seq = %d, veut 2 et 2", seqChanged, seq)
	}

	// Mise à null d'un champ facultatif.
	if got := e.applyOne(devA, op("set_fiche", 200, map[string]any{"fields": map[string]any{"agent_name": nil}})); got != "applied" {
		t.Fatalf("agent_name null : %s", got)
	}
	var name sql.NullString
	if err := e.db.QueryRow(`SELECT agent_name FROM visits WHERE code = ?`, e.code).Scan(&name); err != nil || name.Valid {
		t.Errorf("agent_name = %v, %v, veut NULL", name, err)
	}

	for _, bad := range []map[string]any{
		{"inconnu": 1},
		{"dpe_energy": "H"},
		{"address": ""},
		{"address": nil},
		{"price_eur": "cher"},
		{"bedrooms_count": 21},
	} {
		if got := e.applyOne(devA, op("set_fiche", 300, map[string]any{"fields": bad})); got != "rejected/invalid" {
			t.Errorf("fiche %v : %s, veut rejected/invalid", bad, got)
		}
	}
	if got := e.applyOne(devA, op("set_fiche", 300, map[string]any{})); got != "rejected/invalid" {
		t.Errorf("fields absent : %s, veut rejected/invalid", got)
	}
}

func TestFicheLastWriteWinsPerField(t *testing.T) {
	e := newEnv(t)
	e.apply(devA, op("set_fiche", 200, map[string]any{"fields": map[string]any{"heating_type": "gaz"}}))
	before := e.visitSeq()
	// Ancienne écriture : heating_type perd, agent_name (jamais écrit) gagne.
	res, seq := e.apply(devA, op("set_fiche", 100, map[string]any{"fields": map[string]any{"heating_type": "fioul", "agent_name": "M. Y"}}))
	if outcome(res[0]) != "applied" || seq != before+1 {
		t.Fatalf("résultat %+v, seq %d (avant %d)", res, seq, before)
	}
	if h := e.queryString(`SELECT heating_type FROM visits WHERE code = ?`, e.code); h != "gaz" {
		t.Errorf("heating_type = %q, veut gaz", h)
	}
	if n := e.queryString(`SELECT agent_name FROM visits WHERE code = ?`, e.code); n != "M. Y" {
		t.Errorf("agent_name = %q", n)
	}
	// Tout perd : appliquée sans effet, seq inchangé.
	res, seq = e.apply(devA, op("set_fiche", 50, map[string]any{"fields": map[string]any{"heating_type": "bois"}}))
	if outcome(res[0]) != "applied" || seq != before+1 {
		t.Errorf("sans effet : %+v, seq %d", res, seq)
	}
}

func TestBedroomsChangeKeepsRooms(t *testing.T) {
	e := newEnv(t)
	count := func() int64 {
		return e.queryInt(`SELECT COUNT(*) FROM visit_rooms WHERE visit_code = ? AND kind = 'per_bedroom'`, e.code)
	}
	if count() != 3 {
		t.Fatalf("%d chambres au départ", count())
	}
	if got := e.applyOne(devA, op("set_fiche", 100, map[string]any{"fields": map[string]any{"bedrooms_count": 4}})); got != "applied" {
		t.Fatalf("set_fiche : %s", got)
	}
	if b := e.queryInt(`SELECT bedrooms_count FROM visits WHERE code = ?`, e.code); b != 4 {
		t.Errorf("bedrooms_count = %d, veut 4", b)
	}
	if c := count(); c != 3 {
		t.Errorf("%d chambres, veut toujours 3", c)
	}
}

func TestClosedVisitRejects(t *testing.T) {
	e := newEnv(t)
	if got := e.applyOne(devB, op("close_visit", 100, map[string]any{})); got != "rejected/forbidden" {
		t.Errorf("close_visit par B avant clôture : %s, veut rejected/forbidden", got)
	}
	for _, bad := range []string{`[1]`, `"x"`, `3`} {
		o := ops.Op{OpID: uuid.NewString(), Type: "close_visit", ClientTS: 100, Payload: json.RawMessage(bad)}
		if got := e.applyOne(devA, o); got != "rejected/invalid" {
			t.Errorf("close_visit payload %s : %s, veut rejected/invalid", bad, got)
		}
	}
	res, seq := e.apply(devA, op("close_visit", 100, map[string]any{}))
	if outcome(res[0]) != "applied" {
		t.Fatalf("close_visit par A : %+v", res)
	}
	if c := e.queryString(`SELECT closed_at FROM visits WHERE code = ?`, e.code); c != "2026-10-25T10:00:00Z" {
		t.Errorf("closed_at = %q", c)
	}
	if sc := e.queryInt(`SELECT seq_changed FROM visits WHERE code = ?`, e.code); sc != seq {
		t.Errorf("seq_changed = %d, veut %d", sc, seq)
	}
	note := e.pointOfType(e.code, "note")
	if got := e.applyOne(devB, op("set_rating", 200, map[string]any{"point_id": note, "value": 3})); got != "rejected/closed" {
		t.Errorf("set_rating après clôture : %s, veut rejected/closed", got)
	}
	if got := e.applyOne(devB, op("close_visit", 200, map[string]any{})); got != "rejected/forbidden" {
		t.Errorf("close_visit par B : %s, veut rejected/forbidden", got)
	}
	if got := e.applyOne(devA, op("close_visit", 200, map[string]any{})); got != "rejected/closed" {
		t.Errorf("seconde clôture par A : %s, veut rejected/closed", got)
	}
	if got := e.applyOne(devB, op("add_room", 200, map[string]any{"id": uuid.NewString(), "name": "Cellier"})); got != "rejected/closed" {
		t.Errorf("add_room après clôture : %s, veut rejected/closed", got)
	}
}

func TestUnknownTarget(t *testing.T) {
	e := newEnv(t)
	e.createVisit("autre-maison")
	otherPoint := e.pointOfType("autre-maison", "note")
	otherRoom := e.queryString(`SELECT id FROM visit_rooms WHERE visit_code = 'autre-maison' LIMIT 1`)
	otherQuestion := e.queryString(`SELECT q.id FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id
		WHERE r.visit_code = 'autre-maison' LIMIT 1`)
	cases := []struct {
		name string
		op   ops.Op
	}{
		{"set_rating inconnu", op("set_rating", 1, map[string]any{"point_id": uuid.NewString(), "value": 3})},
		{"set_rating autre visite", op("set_rating", 1, map[string]any{"point_id": otherPoint, "value": 3})},
		{"set_comment autre visite", op("set_comment", 1, map[string]any{"room_id": otherRoom, "text": "x"})},
		{"set_shared pièce d'une autre visite", op("set_shared", 1, map[string]any{"target_id": otherRoom, "field": "area_m2", "value": 3})},
		{"set_shared point d'une autre visite", op("set_shared", 1, map[string]any{"target_id": otherPoint, "field": "blocking", "value": true})},
		{"set_shared question d'une autre visite", op("set_shared", 1, map[string]any{"target_id": otherQuestion, "field": "asked", "value": true})},
		{"rename_room inconnu", op("rename_room", 1, map[string]any{"room_id": uuid.NewString(), "name": "x"})},
		{"hide_room autre visite", op("hide_room", 1, map[string]any{"room_id": otherRoom})},
		{"add_point autre visite", op("add_point", 1, map[string]any{"id": uuid.NewString(), "room_id": otherRoom, "label": "x", "type": "note", "options": []string{}})},
		{"add_question inconnu", op("add_question", 1, map[string]any{"id": uuid.NewString(), "room_id": uuid.NewString(), "text": "x"})},
		{"add_room section inconnue", op("add_room", 1, map[string]any{"id": uuid.NewString(), "name": "x", "from_section_id": "sec-nulle"})},
	}
	for _, c := range cases {
		if got := e.applyOne(devB, c.op); got != "rejected/not_found" {
			t.Errorf("%s : %s, veut rejected/not_found", c.name, got)
		}
	}
	if h := e.queryInt(`SELECT hidden FROM visit_rooms WHERE id = ?`, otherRoom); h != 0 {
		t.Error("pièce d'une autre visite masquée")
	}
}

func TestAddRoomFromSection(t *testing.T) {
	e := newEnv(t)
	id := uuid.NewString()
	maxPos := e.queryInt(`SELECT MAX(position) FROM visit_rooms WHERE visit_code = ?`, e.code)
	if got := e.applyOne(devB, op("add_room", 100, map[string]any{"id": id, "name": "Salle de bain", "from_section_id": "sec-salle-de-bain"})); got != "applied" {
		t.Fatalf("add_room : %s", got)
	}
	if d := e.queryString(`SELECT dir_name FROM visit_rooms WHERE id = ?`, id); d != "salle-de-bain-2" {
		t.Errorf("dir_name = %q, veut salle-de-bain-2", d)
	}
	if k := e.queryString(`SELECT kind FROM visit_rooms WHERE id = ?`, id); k != "room" {
		t.Errorf("kind = %q", k)
	}
	if p := e.queryInt(`SELECT position FROM visit_rooms WHERE id = ?`, id); p != maxPos+1 {
		t.Errorf("position = %d, veut %d", p, maxPos+1)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM visit_points WHERE room_id = ?`, id); n != 9 {
		t.Errorf("%d points, veut 9 (8 + note globale)", n)
	}
	if l := e.queryString(`SELECT label FROM visit_points WHERE room_id = ? AND position = 0`, id); l != "Note globale de la pièce" {
		t.Errorf("premier point = %q", l)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM visit_questions WHERE room_id = ?`, id); n != 4 {
		t.Errorf("%d questions, veut 4", n)
	}
	seq := e.visitSeq()
	if n := e.queryInt(`SELECT COUNT(*) FROM visit_points WHERE room_id = ? AND seq != ?`, id, seq); n != 0 {
		t.Errorf("%d points sans le nouveau seq", n)
	}

	// Une chambre de plus : kind per_bedroom, avec sa note globale.
	bed := uuid.NewString()
	if got := e.applyOne(devB, op("add_room", 100, map[string]any{"id": bed, "name": "Chambre 4", "from_section_id": "sec-chambre"})); got != "applied" {
		t.Fatalf("add_room chambre : %s", got)
	}
	if k := e.queryString(`SELECT kind || ' ' || dir_name FROM visit_rooms WHERE id = ?`, bed); k != "per_bedroom chambre-4" {
		t.Errorf("chambre ajoutée = %q", k)
	}
}

func TestAddEmptyRoom(t *testing.T) {
	e := newEnv(t)
	id := uuid.NewString()
	if got := e.applyOne(devB, op("add_room", 100, map[string]any{"id": id, "name": "  Cuisine  ", "from_section_id": nil})); got != "applied" {
		t.Fatalf("add_room : %s", got)
	}
	if r := e.queryString(`SELECT name || '|' || dir_name || '|' || kind FROM visit_rooms WHERE id = ?`, id); r != "Cuisine|cuisine-2|room" {
		t.Errorf("pièce = %q", r)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM visit_points WHERE room_id = ? AND type = 'note'`, id); n != 1 {
		t.Errorf("%d points, veut la seule note globale", n)
	}
	if n := e.queryInt(`SELECT COUNT(*) FROM visit_points WHERE room_id = ?`, id); n != 1 {
		t.Errorf("%d points, veut 1", n)
	}
	for name, o := range map[string]ops.Op{
		"id existant":   op("add_room", 1, map[string]any{"id": id, "name": "Autre"}),
		"nom vide":      op("add_room", 1, map[string]any{"id": uuid.NewString(), "name": "  "}),
		"id absent":     op("add_room", 1, map[string]any{"name": "Autre"}),
		"id d'un point": op("add_room", 1, map[string]any{"id": e.pointOfType(e.code, "note"), "name": "Autre"}),
	} {
		if got := e.applyOne(devB, o); got != "rejected/invalid" {
			t.Errorf("%s : %s, veut rejected/invalid", name, got)
		}
	}
}

func TestRenameAndHideRoom(t *testing.T) {
	e := newEnv(t)
	room := e.roomByDir("cuisine")
	if got := e.applyOne(devB, op("rename_room", 1, map[string]any{"room_id": room, "name": " Cuisine ouverte "})); got != "applied" {
		t.Fatalf("rename_room : %s", got)
	}
	if r := e.queryString(`SELECT name || '|' || dir_name FROM visit_rooms WHERE id = ?`, room); r != "Cuisine ouverte|cuisine" {
		t.Errorf("après renommage = %q", r)
	}
	if got := e.applyOne(devB, op("rename_room", 1, map[string]any{"room_id": room, "name": ""})); got != "rejected/invalid" {
		t.Errorf("nom vide : %s", got)
	}
	_, seq := e.apply(devB, op("hide_room", 1, map[string]any{"room_id": room}))
	if h := e.queryInt(`SELECT hidden FROM visit_rooms WHERE id = ?`, room); h != 1 {
		t.Errorf("hidden = %d", h)
	}
	if s := e.queryInt(`SELECT seq FROM visit_rooms WHERE id = ?`, room); s != seq {
		t.Errorf("seq de la pièce = %d, veut %d", s, seq)
	}
}

func TestAddPointAndQuestion(t *testing.T) {
	e := newEnv(t)
	room := e.roomByDir("cuisine")
	maxPt := e.queryInt(`SELECT MAX(position) FROM visit_points WHERE room_id = ?`, room)
	pt := uuid.NewString()
	if got := e.applyOne(devB, op("add_point", 1, map[string]any{"id": pt, "room_id": room, "label": "Hotte", "type": "constat", "options": []string{"bon", "usé"}})); got != "applied" {
		t.Fatalf("add_point : %s", got)
	}
	if r := e.queryString(`SELECT label || '|' || type || '|' || options || '|' || weight || '|' || position FROM visit_points WHERE id = ?`, pt); r != fmt.Sprintf(`Hotte|constat|["bon","usé"]|1.0|%d`, maxPt+1) {
		t.Errorf("point = %q", r)
	}
	note := uuid.NewString()
	if got := e.applyOne(devB, op("add_point", 1, map[string]any{"id": note, "room_id": room, "label": "Lumière", "type": "note"})); got != "applied" {
		t.Errorf("add_point note sans options : %s", got)
	}
	if o := e.queryString(`SELECT options FROM visit_points WHERE id = ?`, note); o != "[]" {
		t.Errorf("options = %q, veut []", o)
	}
	for name, p := range map[string]map[string]any{
		"constat sans options": {"id": uuid.NewString(), "room_id": room, "label": "x", "type": "constat", "options": []string{}},
		"note avec options":    {"id": uuid.NewString(), "room_id": room, "label": "x", "type": "note", "options": []string{"a"}},
		"type inconnu":         {"id": uuid.NewString(), "room_id": room, "label": "x", "type": "autre"},
		"libellé vide":         {"id": uuid.NewString(), "room_id": room, "label": " ", "type": "case"},
		"id existant":          {"id": pt, "room_id": room, "label": "x", "type": "case"},
		"id d'une pièce":       {"id": room, "room_id": room, "label": "x", "type": "case"},
	} {
		if got := e.applyOne(devB, op("add_point", 1, p)); got != "rejected/invalid" {
			t.Errorf("add_point %s : %s, veut rejected/invalid", name, got)
		}
	}

	maxQ := e.queryInt(`SELECT MAX(position) FROM visit_questions WHERE room_id = ?`, room)
	q := uuid.NewString()
	if got := e.applyOne(devB, op("add_question", 1, map[string]any{"id": q, "room_id": room, "text": "Âge de la hotte ?"})); got != "applied" {
		t.Fatalf("add_question : %s", got)
	}
	if p := e.queryInt(`SELECT position FROM visit_questions WHERE id = ?`, q); p != maxQ+1 {
		t.Errorf("position = %d, veut %d", p, maxQ+1)
	}
	if got := e.applyOne(devB, op("add_question", 1, map[string]any{"id": q, "room_id": room, "text": "x"})); got != "rejected/invalid" {
		t.Errorf("question en double : %s", got)
	}
	if got := e.applyOne(devB, op("add_question", 1, map[string]any{"id": uuid.NewString(), "room_id": room, "text": ""})); got != "rejected/invalid" {
		t.Errorf("question vide : %s", got)
	}
}

func TestCommentLastWriteWins(t *testing.T) {
	e := newEnv(t)
	room := e.roomByDir("cuisine")
	e.apply(devB, op("set_comment", 200, map[string]any{"room_id": room, "text": "récent"}))
	if got := e.applyOne(devB, op("set_comment", 100, map[string]any{"room_id": room, "text": "ancien"})); got != "applied" {
		t.Fatalf("ancien : %s", got)
	}
	if c := e.queryString(`SELECT text FROM room_comments WHERE room_id = ? AND device_id = ?`, room, devB); c != "récent" {
		t.Errorf("commentaire = %q", c)
	}
	if got := e.applyOne(devB, op("set_comment", 300, map[string]any{"room_id": room})); got != "rejected/invalid" {
		t.Errorf("text absent : %s", got)
	}
	if got := e.applyOne(devB, op("set_comment", 300, map[string]any{"room_id": room, "text": ""})); got != "applied" {
		t.Errorf("commentaire vidé : %s", got)
	}
}

func TestRejectedDoesNotBlockBatch(t *testing.T) {
	e := newEnv(t)
	res, _ := e.apply(devB,
		op("set_rating", 1, map[string]any{"point_id": e.pointOfType(e.code, "note"), "value": 9}),
		op("set_comment", 1, map[string]any{"room_id": e.roomByDir("cuisine"), "text": "ok"}),
	)
	if outcome(res[0]) != "rejected/invalid" || outcome(res[1]) != "applied" {
		t.Errorf("résultats = %+v", res)
	}
}

func TestInvalidOps(t *testing.T) {
	e := newEnv(t)
	cases := map[string]ops.Op{
		"type inconnu":      op("drop_table", 1, map[string]any{}),
		"payload illisible": {OpID: uuid.NewString(), Type: "set_comment", ClientTS: 1, Payload: json.RawMessage(`[1,2]`)},
		"payload absent":    {OpID: uuid.NewString(), Type: "set_rating", ClientTS: 1},
	}
	for name, o := range cases {
		if got := e.applyOne(devB, o); got != "rejected/invalid" {
			t.Errorf("%s : %s, veut rejected/invalid", name, got)
		}
	}
	if got := e.applyOne(devB, ops.Op{Type: "hide_room", ClientTS: 1, Payload: json.RawMessage(`{}`)}); got != "rejected/invalid" {
		t.Errorf("op_id vide : %s", got)
	}
}

func TestSeqIncrements(t *testing.T) {
	e := newEnv(t)
	start := e.visitSeq()
	note := e.pointOfType(e.code, "note")
	o1 := op("set_rating", 100, map[string]any{"point_id": note, "value": 3})
	o2 := op("set_comment", 100, map[string]any{"room_id": e.roomByDir("cuisine"), "text": "a"})
	res, seq := e.apply(devB, o1, o2)
	if outcome(res[0]) != "applied" || outcome(res[1]) != "applied" || seq != start+2 {
		t.Fatalf("résultats %+v, seq %d, veut %d", res, seq, start+2)
	}
	if s := e.queryInt(`SELECT seq FROM ratings WHERE point_id = ?`, note); s != start+1 {
		t.Errorf("seq de la note = %d, veut %d", s, start+1)
	}
	if _, seq = e.apply(devB, o1); seq != start+2 {
		t.Errorf("après duplicate : seq %d, veut %d", seq, start+2)
	}
	// Écriture plus ancienne : appliquée sans effet, seq inchangé.
	if _, seq = e.apply(devB, op("set_rating", 50, map[string]any{"point_id": note, "value": 1})); seq != start+2 {
		t.Errorf("après écriture perdante : seq %d, veut %d", seq, start+2)
	}
	// Refusée : seq inchangé.
	if _, seq = e.apply(devB, op("set_rating", 500, map[string]any{"point_id": note, "value": 7})); seq != start+2 {
		t.Errorf("après refus : seq %d, veut %d", seq, start+2)
	}
	if _, seq = e.apply(devB); seq != start+2 {
		t.Errorf("lot vide : seq %d", seq)
	}
}

func TestEmptyBatchResultsNotNil(t *testing.T) {
	e := newEnv(t)
	res, _, err := ops.ApplyBatch(context.Background(), e.s, e.code, devB, nil, testNow)
	if err != nil || res == nil {
		t.Fatalf("lot vide : %v, %v", res, err)
	}
}

func TestUnknownVisit(t *testing.T) {
	e := newEnv(t)
	batches := map[string][]ops.Op{
		"lot vide":     {},
		"hide_room":    {op("hide_room", 1, map[string]any{"room_id": "x"})},
		"type inconnu": {op("drop_table", 1, map[string]any{})},
		"op_id vide":   {{Type: "hide_room", ClientTS: 1, Payload: json.RawMessage(`{}`)}},
	}
	for name, batch := range batches {
		_, _, err := ops.ApplyBatch(context.Background(), e.s, "nulle-part", devB, batch, testNow)
		if !errors.Is(err, store.ErrNotFound) {
			t.Errorf("visite inconnue, %s : err = %v, veut ErrNotFound", name, err)
		}
	}
}
