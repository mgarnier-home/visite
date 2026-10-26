package model

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestValidCode(t *testing.T) {
	tests := []struct {
		code string
		want bool
	}{
		{"maison-nantes-centre", true},
		{"ab", false},
		{"abc", true},
		{"-abc", false},
		{"abc-", false},
		{"Maison", false},
		{strings.Repeat("a", 60), true},
		{strings.Repeat("a", 61), false},
	}
	for _, tt := range tests {
		if got := ValidCode(tt.code); got != tt.want {
			t.Errorf("ValidCode(%q) = %v, want %v", tt.code, got, tt.want)
		}
	}
}

func TestSlugify(t *testing.T) {
	tests := []struct{ in, want string }{
		{"Cuisine", "cuisine"},
		{"Chambre 2", "chambre-2"},
		{"Salle d'eau é", "salle-d-eau-e"},
		{"???", "piece"},
		{"  Garage  ", "garage"},
		{"Séjour / salon", "sejour-salon"},
		{strings.Repeat("a", 70), strings.Repeat("a", 60)},
	}
	for _, tt := range tests {
		if got := Slugify(tt.in); got != tt.want {
			t.Errorf("Slugify(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func tplWith(kind SectionKind, p TemplatePoint) Template {
	return Template{Version: 1, Sections: []TemplateSection{{
		ID: "s1", Name: "S", Kind: kind, Points: []TemplatePoint{p},
	}}}
}

func TestTemplateValidate(t *testing.T) {
	tests := []struct {
		name string
		tpl  Template
		ok   bool
	}{
		{"constat avec options", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeConstat, Options: []string{"a"}, Weight: 1}), true},
		{"note sans options", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeNote, Weight: 2}), true},
		{"constat sans options", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeConstat, Weight: 1}), false},
		{"note avec options", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeNote, Options: []string{"a"}, Weight: 1}), false},
		{"type inconnu", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: "autre", Weight: 1}), false},
		{"kind inconnu", tplWith("autre", TemplatePoint{ID: "p", Label: "l", Type: TypeNote, Weight: 1}), false},
		{"poids nul", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeNote, Weight: 0}), false},
		{"poids négatif", tplWith(KindRoom, TemplatePoint{ID: "p", Label: "l", Type: TypeNote, Weight: -1}), false},
	}
	for _, tt := range tests {
		err := tt.tpl.Validate()
		if (err == nil) != tt.ok {
			t.Errorf("%s : err = %v, ok attendu = %v", tt.name, err, tt.ok)
		}
		if err != nil && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s : l'erreur doit envelopper ErrInvalid : %v", tt.name, err)
		}
	}
}

func TestValidPointShape(t *testing.T) {
	tests := []struct {
		name    string
		typ     PointType
		options []string
		ok      bool
	}{
		{"constat avec options", TypeConstat, []string{"a"}, true},
		{"constat sans options", TypeConstat, nil, false},
		{"constat options vides", TypeConstat, []string{}, false},
		{"note sans options", TypeNote, nil, true},
		{"case sans options", TypeCase, []string{}, true},
		{"note avec options", TypeNote, []string{"a"}, false},
		{"case avec options", TypeCase, []string{"a"}, false},
		{"type inconnu", "autre", nil, false},
	}
	for _, tt := range tests {
		err := ValidPointShape(tt.typ, tt.options)
		if (err == nil) != tt.ok {
			t.Errorf("%s : err = %v, ok attendu = %v", tt.name, err, tt.ok)
		}
		if err != nil && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s : l'erreur doit envelopper ErrInvalid : %v", tt.name, err)
		}
	}
}

func TestTemplateValidateIDs(t *testing.T) {
	pt := func(id string) TemplatePoint {
		return TemplatePoint{ID: id, Label: "l", Type: TypeNote, Weight: 1}
	}
	q := func(id string) TemplateQuestion { return TemplateQuestion{ID: id, Text: "t"} }
	sec := func(id string, pts []TemplatePoint, qs []TemplateQuestion) TemplateSection {
		return TemplateSection{ID: id, Name: "S", Kind: KindRoom, Points: pts, Questions: qs}
	}
	tests := []struct {
		name string
		secs []TemplateSection
		ok   bool
	}{
		{"ids distincts", []TemplateSection{
			sec("s1", []TemplatePoint{pt("p1")}, []TemplateQuestion{q("q1")}),
			sec("s2", []TemplatePoint{pt("p2")}, []TemplateQuestion{q("q2")}),
		}, true},
		{"section sans id", []TemplateSection{sec("", nil, nil)}, false},
		{"sections en double", []TemplateSection{sec("s1", nil, nil), sec("s1", nil, nil)}, false},
		{"point sans id", []TemplateSection{sec("s1", []TemplatePoint{pt("")}, nil)}, false},
		{"points en double dans une section", []TemplateSection{
			sec("s1", []TemplatePoint{pt("p1"), pt("p1")}, nil)}, false},
		{"points en double entre sections", []TemplateSection{
			sec("s1", []TemplatePoint{pt("p1")}, nil),
			sec("s2", []TemplatePoint{pt("p1")}, nil)}, false},
		{"question sans id", []TemplateSection{sec("s1", nil, []TemplateQuestion{q("")})}, false},
		{"questions en double dans une section", []TemplateSection{
			sec("s1", nil, []TemplateQuestion{q("q1"), q("q1")})}, false},
		{"questions en double entre sections", []TemplateSection{
			sec("s1", nil, []TemplateQuestion{q("q1")}),
			sec("s2", nil, []TemplateQuestion{q("q1")})}, false},
		{"même id pour un point et une question", []TemplateSection{
			sec("s1", []TemplatePoint{pt("x")}, []TemplateQuestion{q("x")})}, true},
	}
	for _, tt := range tests {
		err := Template{Version: 1, Sections: tt.secs}.Validate()
		if (err == nil) != tt.ok {
			t.Errorf("%s : err = %v, ok attendu = %v", tt.name, err, tt.ok)
		}
		if err != nil && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s : l'erreur doit envelopper ErrInvalid : %v", tt.name, err)
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestFicheValidate(t *testing.T) {
	tests := []struct {
		name string
		f    Fiche
		ok   bool
	}{
		{"adresse seule", Fiche{Address: "1 rue X"}, true},
		{"adresse vide", Fiche{Address: "  "}, false},
		{"dpe_energy H", Fiche{Address: "a", DPEEnergy: ptr("H")}, false},
		{"dpe_energy C", Fiche{Address: "a", DPEEnergy: ptr("C")}, true},
		{"dpe_ges H", Fiche{Address: "a", DPEGES: ptr("H")}, false},
		{"bedrooms 21", Fiche{Address: "a", BedroomsCount: ptr(21)}, false},
		{"bedrooms 20", Fiche{Address: "a", BedroomsCount: ptr(20)}, true},
		{"bedrooms négatif", Fiche{Address: "a", BedroomsCount: ptr(-1)}, false},
		{"rooms négatif", Fiche{Address: "a", RoomsCount: ptr(-1)}, false},
		{"prix négatif", Fiche{Address: "a", PriceEUR: ptr(-1.0)}, false},
		{"surface négative", Fiche{Address: "a", LivingAreaM2: ptr(-1.0)}, false},
		{"terrain négatif", Fiche{Address: "a", LandAreaM2: ptr(-1.0)}, false},
	}
	for _, tt := range tests {
		err := tt.f.Validate()
		if (err == nil) != tt.ok {
			t.Errorf("%s : err = %v, ok attendu = %v", tt.name, err, tt.ok)
		}
		if err != nil && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s : l'erreur doit envelopper ErrInvalid : %v", tt.name, err)
		}
	}
}

func TestValidSharedValue(t *testing.T) {
	caseP := &Point{Type: TypeCase}
	constatP := &Point{Type: TypeConstat, Options: []string{"bon", "usé"}}
	noteP := &Point{Type: TypeNote}
	tests := []struct {
		name   string
		target TargetKind
		p      *Point
		field  string
		raw    string
		ok     bool
	}{
		{"case ok", TargetPoint, caseP, "value", `"ok"`, true},
		{"case bof", TargetPoint, caseP, "value", `"bof"`, false},
		{"constat option", TargetPoint, constatP, "value", `"bon"`, true},
		{"constat na", TargetPoint, constatP, "value", `"na"`, true},
		{"constat autre", TargetPoint, constatP, "value", `"cassé"`, false},
		{"value sur note", TargetPoint, noteP, "value", `"ok"`, false},
		{"value sans point", TargetPoint, nil, "value", `"ok"`, false},
		{"value null", TargetPoint, caseP, "value", `null`, false},
		{"blocking true", TargetPoint, noteP, "blocking", `true`, true},
		{"blocking oui", TargetPoint, noteP, "blocking", `"oui"`, false},
		{"works 100", TargetPoint, noteP, "works_eur", `100`, true},
		{"works 0", TargetPoint, noteP, "works_eur", `0`, true},
		{"works null", TargetPoint, noteP, "works_eur", `null`, true},
		{"blocking null", TargetPoint, noteP, "blocking", `null`, false},
		{"answer null", TargetQuestion, nil, "answer", `null`, false},
		{"works -1", TargetPoint, noteP, "works_eur", `-1`, false},
		{"works décimal", TargetPoint, noteP, "works_eur", `1.5`, false},
		{"answer question", TargetQuestion, nil, "answer", `"oui"`, true},
		{"answer nombre", TargetQuestion, nil, "answer", `3`, false},
		{"answer point", TargetPoint, noteP, "answer", `"oui"`, false},
		{"asked question", TargetQuestion, nil, "asked", `true`, true},
		{"asked pièce", TargetRoom, nil, "asked", `true`, false},
		{"area pièce", TargetRoom, nil, "area_m2", `12.5`, true},
		{"area null", TargetRoom, nil, "area_m2", `null`, true},
		{"area négative", TargetRoom, nil, "area_m2", `-1`, false},
		{"area point", TargetPoint, noteP, "area_m2", `12`, false},
		{"champ inconnu", TargetRoom, nil, "foo", `1`, false},
		{"notes pièce", TargetRoom, nil, "notes", `"Fenêtre fissurée"`, true},
		{"notes pièce vides", TargetRoom, nil, "notes", `""`, true},
		{"notes pièce nombre", TargetRoom, nil, "notes", `3`, false},
		{"notes pièce null", TargetRoom, nil, "notes", `null`, false},
		{"notes visite", TargetVisit, nil, "notes", `"Rappeler l'agent"`, true},
		{"notes visite null", TargetVisit, nil, "notes", `null`, false},
		{"area visite", TargetVisit, nil, "area_m2", `12`, false},
		{"notes point", TargetPoint, noteP, "notes", `"x"`, false},
		{"notes question", TargetQuestion, nil, "notes", `"x"`, false},
	}
	for _, tt := range tests {
		err := ValidSharedValue(tt.target, tt.p, tt.field, json.RawMessage(tt.raw))
		if (err == nil) != tt.ok {
			t.Errorf("%s : err = %v, ok attendu = %v", tt.name, err, tt.ok)
		}
		if err != nil && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s : l'erreur doit envelopper ErrInvalid : %v", tt.name, err)
		}
	}
}
