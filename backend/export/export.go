// Package export produit l'export CSV d'une visite (spec §9). Il ne dépend pas du store.
package export

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/mgarnier-home/visite/model"
)

// Data : tout ce qu'il faut pour exporter une visite.
// Shared[cible][champ], Ratings[point][participant], Comments[pièce][participant].
// Year est l'année courante (pour l'âge du bâtiment) ; 0 : âge laissé vide.
type Data struct {
	Code         string
	Fiche        model.Fiche
	Participants int
	Rooms        []model.Room
	Points       []model.Point
	Questions    []model.Question
	Shared       map[string]map[string]json.RawMessage
	Ratings      map[string]map[int]*int
	Comments     map[string]map[int]string
	Year         int
}

const fixedCols = 6 // visite, pièce, point, type, réponse partagée, posée

// builder construit les lignes avec la largeur fixe du tableau.
type builder struct {
	d    Data
	rows [][]string
}

func (b *builder) row(room, point, typ, value string) []string {
	r := make([]string, fixedCols+b.d.Participants+2)
	r[0], r[1], r[2], r[3], r[4] = b.d.Code, text(room), text(point), typ, value
	b.rows = append(b.rows, r)
	return r
}

func (b *builder) blockingCol() int { return fixedCols + b.d.Participants }
func (b *builder) worksCol() int    { return fixedCols + b.d.Participants + 1 }

// Rows renvoie l'en-tête puis toutes les lignes de l'export.
func Rows(d Data) [][]string {
	b := &builder{d: d}
	header := []string{"visite", "pièce", "point", "type", "réponse partagée", "posée"}
	for i := 1; i <= d.Participants; i++ {
		header = append(header, "P"+strconv.Itoa(i))
	}
	b.rows = append(b.rows, append(header, "bloquant", "travaux €"))

	b.ficheRows()

	rooms := slices.Clone(d.Rooms)
	slices.SortStableFunc(rooms, func(x, y model.Room) int { return x.Position - y.Position })
	totalWorks := d.visibleWorks()
	for _, room := range rooms {
		if room.Hidden {
			continue
		}
		points := d.pointsOf(room.ID)
		summary := room.Kind == model.KindSummary
		if !summary {
			b.row(room.Name, "surface_m2", "surface", d.sharedValue(room.ID, "area_m2"))
		}
		for _, p := range points {
			b.pointRow(room, p, summary)
		}
		if !summary {
			for _, q := range d.questionsOf(room.ID) {
				r := b.row(room.Name, q.Text, "question", d.sharedValue(q.ID, "answer"))
				r[5] = d.sharedValue(q.ID, "asked")
			}
		}
		b.row(room.Name, "", "notes", d.sharedValue(room.ID, "notes"))
		r := b.row(room.Name, "", "commentaire", "")
		for n := 1; n <= d.Participants; n++ {
			r[fixedCols+n-1] = text(d.Comments[room.ID][n])
		}
		if summary {
			b.summaryRows(room, points, totalWorks)
		}
	}
	return b.rows
}

// pointRow ajoute la ligne d'un point.
func (b *builder) pointRow(room model.Room, p model.Point, summary bool) {
	d := b.d
	r := b.row(room.Name, p.Label, string(p.Type), "")
	switch p.Type {
	case model.TypeNote:
		if summary {
			r[4] = formatNumber(p.Weight)
		}
		for n := 1; n <= d.Participants; n++ {
			if v, ok := d.Ratings[p.ID][n]; ok {
				if v == nil {
					r[fixedCols+n-1] = "N/A"
				} else {
					r[fixedCols+n-1] = strconv.Itoa(*v)
				}
			}
		}
	default:
		r[4] = d.sharedValue(p.ID, "value")
	}
	r[b.blockingCol()] = d.sharedValue(p.ID, "blocking")
	r[b.worksCol()] = d.sharedValue(p.ID, "works_eur")
}

// summaryRows ajoute score pondéré, total travaux et prix réel.
func (b *builder) summaryRows(room model.Room, points []model.Point, total float64) {
	d := b.d
	r := b.row(room.Name, "", "score pondéré", "")
	for n := 1; n <= d.Participants; n++ {
		ratings := map[string]*int{}
		for _, p := range points {
			ratings[p.ID] = d.Ratings[p.ID][n]
		}
		if s := model.WeightedScore(points, ratings); s != nil {
			r[fixedCols+n-1] = formatNumber(*s)
		}
	}
	b.row(room.Name, "", "total travaux", formatNumber(total))
	price := ""
	if d.Fiche.PriceEUR != nil {
		price = formatNumber(*d.Fiche.PriceEUR + model.NotaryFees(*d.Fiche.PriceEUR) + total)
	}
	b.row(room.Name, "", "prix réel", price)
}

func (b *builder) ficheRows() {
	f := b.d.Fiche
	add := func(name, value string) { b.row("Fiche", name, "fiche", value) }
	num := func(v *float64) string {
		if v == nil {
			return ""
		}
		return formatNumber(*v)
	}
	str := func(v *string) string {
		if v == nil {
			return ""
		}
		return text(*v)
	}
	integer := func(v *int) string {
		if v == nil {
			return ""
		}
		return strconv.Itoa(*v)
	}
	add("address", text(f.Address))
	add("price_eur", num(f.PriceEUR))
	add("living_area_m2", num(f.LivingAreaM2))
	add("floor_area_m2", num(f.FloorAreaM2))
	add("land_area_m2", num(f.LandAreaM2))
	add("visit_at", str(f.VisitAt))
	add("agent_name", str(f.AgentName))
	add("agent_phone", str(f.AgentPhone))
	add("agent_email", str(f.AgentEmail))
	add("construction_year", integer(f.ConstructionYear))
	add("dpe_energy", str(f.DPEEnergy))
	add("dpe_ges", str(f.DPEGES))
	add("rooms_count", integer(f.RoomsCount))
	add("bedrooms_count", integer(f.BedroomsCount))
	add("listing_url", str(f.ListingURL))
	add("heating_type", str(f.HeatingType))
	add("notes", b.d.sharedValue(b.d.Code, "notes"))
	add("prix_m2", num(model.PricePerM2(f)))
	fees := ""
	if f.PriceEUR != nil {
		fees = formatNumber(model.NotaryFees(*f.PriceEUR))
	}
	add("frais_notaire", fees)
	age := ""
	if f.ConstructionYear != nil && b.d.Year != 0 {
		age = strconv.Itoa(b.d.Year - *f.ConstructionYear)
	}
	add("age_batiment", age)
}

func (d Data) pointsOf(roomID string) []model.Point {
	var out []model.Point
	for _, p := range d.Points {
		if p.RoomID == roomID {
			out = append(out, p)
		}
	}
	slices.SortStableFunc(out, func(x, y model.Point) int { return x.Position - y.Position })
	return out
}

func (d Data) questionsOf(roomID string) []model.Question {
	var out []model.Question
	for _, q := range d.Questions {
		if q.RoomID == roomID {
			out = append(out, q)
		}
	}
	slices.SortStableFunc(out, func(x, y model.Question) int { return x.Position - y.Position })
	return out
}

// visibleWorks : somme des travaux des points des pièces visibles.
func (d Data) visibleWorks() float64 {
	hidden := map[string]bool{}
	for _, r := range d.Rooms {
		hidden[r.ID] = r.Hidden
	}
	var sum float64
	for _, p := range d.Points {
		if !hidden[p.RoomID] {
			sum += d.works(p.ID)
		}
	}
	return sum
}

func (d Data) works(pointID string) float64 {
	var v float64
	if raw, ok := d.Shared[pointID]["works_eur"]; ok && json.Unmarshal(raw, &v) == nil {
		return v
	}
	return 0
}

// sharedValue rend une valeur partagée prête à écrire : nombre au format français,
// booléen oui/vide, "na" en N/A, absent ou null en vide.
func (d Data) sharedValue(target, field string) string {
	raw, ok := d.Shared[target][field]
	if !ok {
		return ""
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		if x == "na" {
			return "N/A"
		}
		return text(x)
	case float64:
		return formatNumber(x)
	case bool:
		if x {
			return "oui"
		}
	}
	return ""
}

// text neutralise un texte libre qu'un tableur prendrait pour une formule : une apostrophe
// est ajoutée devant =, +, -, @, tabulation ou retour chariot en tête. Ne jamais l'appliquer
// aux nombres formatés (formatNumber), qui doivent rester des nombres.
func text(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}

// formatNumber : virgule décimale, pas de séparateur de milliers, 2 décimales au plus
// sans zéros finaux (2500 ; 4,5 ; 2083,33).
func formatNumber(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "-0" {
		s = "0"
	}
	return strings.Replace(s, ".", ",", 1)
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// Write écrit les lignes en CSV avec le séparateur donné ; bom ajoute le BOM UTF-8.
func Write(w io.Writer, rows [][]string, sep rune, bom bool) error {
	if bom {
		if _, err := io.Copy(w, bytes.NewReader(utf8BOM)); err != nil {
			return err
		}
	}
	cw := csv.NewWriter(w)
	cw.Comma = sep
	cw.UseCRLF = false
	if err := cw.WriteAll(rows); err != nil {
		return err
	}
	return cw.Error()
}
