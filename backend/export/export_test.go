package export

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/mgarnier-home/visite/model"
)

func ptr[T any](v T) *T { return &v }

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func fixture() Data {
	return Data{
		Code: "maison-test",
		Fiche: model.Fiche{
			Address: "1 rue des Lilas", PriceEUR: ptr(250000.0), LivingAreaM2: ptr(120.0),
			VisitAt: ptr("2026-10-25T10:00:00Z"), AgentName: ptr("Mme Martin"),
			ConstructionYear: ptr(1990), BedroomsCount: ptr(3),
		},
		Participants: 2,
		Rooms: []model.Room{
			{ID: "r-bilan", Name: "Bilan", Kind: model.KindSummary, Position: 3},
			{ID: "r-cave", Name: "Cave", Kind: model.KindRoom, Position: 2, Hidden: true},
			{ID: "r-salon", Name: "Salon", Kind: model.KindRoom, Position: 1},
		},
		Points: []model.Point{
			{ID: "p-lum", RoomID: "r-salon", Label: "Luminosité", Type: model.TypeNote, Weight: 1, Position: 1},
			{ID: "p-fen", RoomID: "r-salon", Label: "Fenêtres", Type: model.TypeCase, Position: 2},
			{ID: "p-sol", RoomID: "r-salon", Label: "Sol", Type: model.TypeConstat, Position: 3},
			{ID: "p-hum", RoomID: "r-cave", Label: "Humidité", Type: model.TypeCase, Position: 1},
			{ID: "p-qua", RoomID: "r-bilan", Label: "Quartier", Type: model.TypeNote, Weight: 2, Position: 1},
			{ID: "p-cal", RoomID: "r-bilan", Label: "Calme", Type: model.TypeNote, Weight: 1, Position: 2},
		},
		Questions: []model.Question{
			{ID: "q-ch", RoomID: "r-salon", Text: "Charges ?", Position: 1},
		},
		Shared: map[string]map[string]json.RawMessage{
			"maison-test": {"notes": raw(`"Rappeler l'agent"`)},
			"r-salon":     {"area_m2": raw("22.5"), "notes": raw(`"Fenêtre fissurée"`)},
			"p-fen":       {"value": raw(`"problem"`), "blocking": raw("true"), "works_eur": raw("1500")},
			"p-sol":       {"value": raw(`"parquet"`), "blocking": raw("false")},
			"p-hum":       {"works_eur": raw("999")},
			"q-ch":        {"answer": raw(`"120 €/mois"`), "asked": raw("true")},
		},
		Ratings: map[string]map[int]*int{
			"p-lum": {1: ptr(4), 2: nil},
			"p-qua": {1: ptr(4), 2: ptr(5)},
			"p-cal": {1: ptr(5)},
		},
		Comments: map[string]map[int]string{
			"r-salon": {1: "RAS", 2: "a;b"},
			"r-bilan": {2: "ok"},
		},
		Year: 2026,
	}
}

func write(t *testing.T, d Data, sep rune, bom bool) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := Write(&buf, Rows(d), sep, bom); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestRowsGolden(t *testing.T) {
	want, err := os.ReadFile("testdata/visit.golden.csv")
	if err != nil {
		t.Fatal(err)
	}
	got := write(t, fixture(), ';', true)
	if !bytes.Equal(got, want) {
		t.Errorf("export différent du golden\n--- obtenu ---\n%s\n--- attendu ---\n%s", got, want)
	}
}

func TestEscaping(t *testing.T) {
	d := fixture()
	const c = "a;b \"c\"\nd"
	d.Comments["r-salon"][1] = c
	out := bytes.TrimPrefix(write(t, d, ';', true), []byte{0xEF, 0xBB, 0xBF})
	r := csv.NewReader(bytes.NewReader(out))
	r.Comma = ';'
	recs, err := r.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	for _, rec := range recs {
		if rec[3] == "commentaire" && rec[1] == "Salon" {
			if rec[6] != c {
				t.Errorf("commentaire = %q, attendu %q", rec[6], c)
			}
			return
		}
	}
	t.Fatal("ligne commentaire du salon introuvable")
}

func TestTabNoBOM(t *testing.T) {
	out := write(t, fixture(), '\t', false)
	if bytes.HasPrefix(out, []byte{0xEF, 0xBB, 0xBF}) {
		t.Error("BOM présent")
	}
	if !strings.HasPrefix(string(out), "visite\tpièce\t") {
		t.Errorf("en-tête inattendu : %q", out[:30])
	}
}

func TestHiddenRoomExcluded(t *testing.T) {
	out := string(write(t, fixture(), ';', true))
	if strings.Contains(out, "Cave") || strings.Contains(out, "Humidité") {
		t.Error("la pièce masquée apparaît dans l'export")
	}
	if !strings.Contains(out, ";total travaux;1500;") {
		t.Error("les travaux de la pièce masquée sont comptés")
	}
}

func TestNullWorksIsEmptyAndNotCounted(t *testing.T) {
	d := fixture()
	d.Shared["p-fen"]["works_eur"] = raw("null")
	d.Shared["r-salon"]["area_m2"] = raw("null")
	out := string(write(t, d, ';', true))
	if strings.Contains(out, "null") {
		t.Error("\"null\" apparaît dans l'export")
	}
	if !strings.Contains(out, ";total travaux;0;") {
		t.Errorf("total travaux attendu 0 :\n%s", out)
	}
}

func TestAgeEmptyWithoutYear(t *testing.T) {
	d := fixture()
	d.Year = 0
	for _, r := range Rows(d) {
		if r[2] == "age_batiment" && r[4] != "" {
			t.Errorf("age_batiment = %q, attendu vide", r[4])
		}
	}
}

func TestFormatNumber(t *testing.T) {
	for in, want := range map[float64]string{2500: "2500", 22500: "22500", 4.5: "4,5", 2083.333: "2083,33", 0: "0", 0.001: "0"} {
		if got := formatNumber(in); got != want {
			t.Errorf("formatNumber(%v) = %q, attendu %q", in, got, want)
		}
	}
}

// cell renvoie la cellule col de la première ligne dont la colonne type vaut typ et la
// colonne point vaut point.
func cell(t *testing.T, rows [][]string, typ, point string, col int) string {
	t.Helper()
	for _, r := range rows {
		if r[3] == typ && r[2] == point {
			return r[col]
		}
	}
	t.Fatalf("ligne %s/%s introuvable", typ, point)
	return ""
}

func TestFormulaInjectionEscaped(t *testing.T) {
	for _, prefix := range []string{"=", "+", "-", "@", "\t", "\r"} {
		d := fixture()
		v := prefix + "x"
		d.Fiche.Address = v
		d.Fiche.AgentPhone = ptr(v)
		d.Fiche.ListingURL = ptr(v)
		d.Rooms[2].Name = v
		d.Points[0].Label = v
		d.Points[2].Label = "Sol"
		d.Questions[0].Text = v
		d.Shared["p-sol"]["value"] = raw(strconv.Quote(v))
		d.Shared["q-ch"]["answer"] = raw(strconv.Quote(v))
		d.Comments["r-salon"][1] = v
		rows := Rows(d)
		want := "'" + v
		checks := map[string]string{
			"address":     cell(t, rows, "fiche", "address", 4),
			"agent_phone": cell(t, rows, "fiche", "agent_phone", 4),
			"listing_url": cell(t, rows, "fiche", "listing_url", 4),
			"pièce":       cell(t, rows, "note", want, 1),
			"point":       cell(t, rows, "note", want, 2),
			"constat":     cell(t, rows, "constat", "Sol", 4),
			"question":    cell(t, rows, "question", want, 2),
			"réponse":     cell(t, rows, "question", want, 4),
			"commentaire": cell(t, rows, "commentaire", "", fixedCols),
		}
		for name, got := range checks {
			if got != want {
				t.Errorf("préfixe %q, %s = %q, attendu %q", prefix, name, got, want)
			}
		}
	}
}

func TestFormulaEscapingLeavesNumbersAlone(t *testing.T) {
	d := fixture()
	d.Shared["p-fen"]["works_eur"] = raw("-1500")
	d.Shared["p-sol"]["value"] = raw(`"sain"`)
	rows := Rows(d)
	if got := cell(t, rows, "case", "Fenêtres", fixedCols+d.Participants+1); got != "-1500" {
		t.Errorf("travaux = %q, attendu -1500", got)
	}
	if got := cell(t, rows, "total travaux", "", 4); got != "-1500" {
		t.Errorf("total travaux = %q, attendu -1500", got)
	}
	if got := cell(t, rows, "constat", "Sol", 4); got != "sain" {
		t.Errorf("constat = %q, attendu sain", got)
	}
}
