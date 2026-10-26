package seed

import (
	"slices"
	"strings"
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

	if len(tpl.Sections) != 11 {
		t.Fatalf("%d sections, attendu 11", len(tpl.Sections))
	}
	wantNames := []string{
		"Questions générales", "Extérieur et structure", "Cuisine",
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
		"Extérieur et structure":               {9, 4},
		"Cuisine":                              {8, 4},
		"Salon / séjour":                       {9, 3},
		"Chambre":                              {9, 0},
		"Salle de bain":                        {8, 4},
		"Toilettes":                            {5, 2},
		"Garage":                               {10, 6},
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

	ext := byName["Extérieur et structure"].Points
	if !strings.HasPrefix(ext[len(ext)-1].Label, "Porte d'entrée") {
		t.Errorf("dernier point d'Extérieur = %q", ext[len(ext)-1].Label)
	}

	garage := byName["Garage"]
	if !strings.HasPrefix(garage.Points[0].Label, "Tableau électrique") ||
		!strings.HasPrefix(garage.Points[1].Label, "Compteurs") {
		t.Errorf("points de tête du Garage = %q, %q", garage.Points[0].Label, garage.Points[1].Label)
	}
	wantGarageQ := []string{
		"L'installation électrique a-t-elle été refaite ? Quand ?",
		"Y a-t-il une alarme ou un visiophone ?",
		"La fibre est-elle raccordée ?",
	}
	for i, w := range wantGarageQ {
		if garage.Questions[i].Text != w {
			t.Errorf("question %d du Garage = %q, attendu %q", i, garage.Questions[i].Text, w)
		}
	}

	general := byName["Questions générales"].Questions
	if last := general[len(general)-1]; last.Text != "Y a-t-il un plancher chauffant ou une climatisation ?" ||
		last.ID != "q-general-plancher" {
		t.Errorf("dernière question générale = %+v", last)
	}
	for _, q := range general {
		if strings.HasPrefix(q.Text, "Les chambres à l'étage") {
			t.Errorf("question supprimée encore présente : %q", q.Text)
		}
	}

	wantImportant := map[string]int{
		"Extérieur et structure": 3, "Cuisine": 3, "Salon / séjour": 1,
		"Salle de bain": 4, "Toilettes": 1, "Garage": 3,
		"Combles, cave, buanderie, chaufferie": 3, "Environnement et quartier": 3,
	}
	total := 0
	for _, s := range tpl.Sections {
		n := 0
		for _, q := range s.Questions {
			if q.Important {
				n++
			}
		}
		total += n
		if n != wantImportant[s.Name] {
			t.Errorf("%s : %d questions importantes, attendu %d", s.Name, n, wantImportant[s.Name])
		}
		if s.Kind == model.KindTopic && n != 0 {
			t.Errorf("%s (topic) ne doit avoir aucune question importante", s.Name)
		}
	}
	if total != 21 {
		t.Errorf("%d questions importantes au total, attendu 21", total)
	}
}
