package seed

import (
	"slices"
	"testing"

	"github.com/mgarnier-home/visite/model"
)

func TestSeedTemplate(t *testing.T) {
	tpl, err := Template()
	if err != nil {
		t.Fatal(err)
	}
	if err := tpl.Validate(); err != nil {
		t.Fatalf("la seed doit être valide : %v", err)
	}
	if tpl.PackingList == "" {
		t.Error("packing_list vide")
	}

	wantNames := []string{
		"Questions générales", "Extérieur et structure", "Entrée", "Cuisine",
		"Salon / séjour", "Chambre", "Salle de bain", "Toilettes", "Garage",
		"Combles, cave, buanderie, chaufferie", "Environnement et quartier", "Bilan",
	}
	var names []string
	for i, s := range tpl.Sections {
		names = append(names, s.Name)
		if s.Position != i {
			t.Errorf("section %q : position %d, attendu %d", s.ID, s.Position, i)
		}
	}
	if !slices.Equal(names, wantNames) {
		t.Fatalf("sections = %q", names)
	}

	byName := map[string]model.TemplateSection{}
	for _, s := range tpl.Sections {
		byName[s.Name] = s
		for i, p := range s.Points {
			if p.Position != i {
				t.Errorf("point %q : position %d, attendu %d", p.ID, p.Position, i)
			}
		}
		for i, q := range s.Questions {
			if q.Position != i {
				t.Errorf("question %q : position %d, attendu %d", q.ID, q.Position, i)
			}
		}
	}

	wantKinds := map[string]model.SectionKind{
		"Questions générales": model.KindTopic,
		"Chambre":             model.KindPerBedroom,
		"Bilan":               model.KindSummary,
		"Cuisine":             model.KindRoom,
	}
	for name, kind := range wantKinds {
		if byName[name].Kind != kind {
			t.Errorf("%s : kind %q, attendu %q", name, byName[name].Kind, kind)
		}
	}

	wantCounts := map[string][2]int{ // points, questions
		"Questions générales":                  {0, 18},
		"Extérieur et structure":               {8, 4},
		"Entrée":                               {4, 3},
		"Cuisine":                              {8, 4},
		"Salon / séjour":                       {9, 4},
		"Chambre":                              {9, 0},
		"Salle de bain":                        {8, 4},
		"Toilettes":                            {5, 2},
		"Garage":                               {8, 3},
		"Combles, cave, buanderie, chaufferie": {5, 4},
		"Environnement et quartier":            {6, 3},
		"Bilan":                                {8, 0},
	}
	for name, want := range wantCounts {
		s := byName[name]
		if len(s.Points) != want[0] || len(s.Questions) != want[1] {
			t.Errorf("%s : %d points / %d questions, attendu %d / %d",
				name, len(s.Points), len(s.Questions), want[0], want[1])
		}
	}

	hotte := byName["Cuisine"].Points[4]
	if hotte.Label != "Hotte" || hotte.Type != model.TypeConstat || len(hotte.Options) != 3 {
		t.Errorf("hotte = %+v", hotte)
	}

	bilan := byName["Bilan"].Points
	if bilan[0].Label != "Emplacement" || bilan[0].Weight != 3 {
		t.Errorf("emplacement = %+v", bilan[0])
	}
	wantWeights := []float64{3, 1, 2, 2, 1, 1, 2, 1}
	for i, p := range bilan {
		if p.Weight != wantWeights[i] {
			t.Errorf("bilan %q : poids %v, attendu %v", p.Label, p.Weight, wantWeights[i])
		}
	}
	next := bilan[7]
	if next.Label != "Prochaine étape" || next.Type != model.TypeConstat ||
		!slices.Equal(next.Options, []string{"Deuxième visite", "Devis artisans", "Offre", "On passe"}) {
		t.Errorf("prochaine étape = %+v", next)
	}
}
