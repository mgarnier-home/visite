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

	if len(tpl.Sections) != 12 {
		t.Fatalf("%d sections, attendu 12", len(tpl.Sections))
	}
	wantNames := []string{
		"Questions générales", "Extérieur et structure", "Cuisine",
		"Salon / séjour", "Chambre", "Salle de bain", "Toilettes", "Garage",
		"Combles", "Cave, buanderie, chaufferie", "Environnement et quartier", "Bilan",
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
		"Combles":             model.KindRoom,
	}
	for name, kind := range wantKinds {
		if byName[name].Kind != kind {
			t.Errorf("%s : kind %q, attendu %q", name, byName[name].Kind, kind)
		}
	}

	wantCounts := map[string][2]int{ // points, questions
		"Questions générales":         {0, 15},
		"Extérieur et structure":      {9, 4},
		"Cuisine":                     {8, 4},
		"Salon / séjour":              {9, 2},
		"Chambre":                     {8, 0},
		"Salle de bain":               {7, 3},
		"Toilettes":                   {5, 2},
		"Garage":                      {9, 6},
		"Combles":                     {2, 2},
		"Cave, buanderie, chaufferie": {4, 3},
		"Environnement et quartier":   {6, 3},
		"Bilan":                       {8, 0},
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
	if last := general[len(general)-1]; last.Text != "Quel est le mode de chauffage principal ? Quel coût annuel ?" || !last.Important {
		t.Errorf("dernière question générale = %+v", last)
	}
	if last := garage.Points[len(garage.Points)-1]; last.Label != "Place pour lave-linge et sèche-linge" {
		t.Errorf("dernier point du Garage = %q", last.Label)
	}

	// éléments retirés du modèle, quelle que soit leur section d'origine
	removed := []string{
		"Les chambres à l'étage", "Y a-t-il un plancher chauffant", "Quelle chambre est la plus chaude",
		"Le dossier de diagnostics", "Quel est le système d'eau chaude", "Dimensions : voitures", "Surface et forme",
	}
	for _, s := range tpl.Sections {
		for _, text := range append(labels(s.Points), texts(s.Questions)...) {
			for _, r := range removed {
				if strings.HasPrefix(text, r) {
					t.Errorf("%s : élément supprimé encore présent : %q", s.Name, text)
				}
			}
		}
	}

	combles := byName["Combles"]
	if !slices.Equal(labels(combles.Points), []string{
		"Charpente et plafond : insectes, humidité, plaques fibrociment",
		"Combles : isolant, fuites sous toiture, charpente",
	}) || !combles.Points[0].Important || combles.Points[1].Important {
		t.Errorf("points des Combles = %+v", combles.Points)
	}
	if !slices.Equal(texts(combles.Questions), []string{
		"Les combles ou le grenier sont-ils aménageables en chambre supplémentaire ? Si oui, quelle serait la hauteur sous plafond ?",
		"Les combles ont-ils été isolés ? Avec quoi et quand ?",
	}) || !combles.Questions[0].Important || combles.Questions[1].Important {
		t.Errorf("questions des Combles = %+v", combles.Questions)
	}

	// éléments secondaires (masqués par défaut), section par section ; tout le reste est important
	wantSecondary := map[string][]string{
		"Questions générales": {
			"Lotissement ou copropriété ? Charges, règlement, ASL ?",
			"Y a-t-il des servitudes, un droit de passage, des projets de construction à proximité ?",
		},
		"Extérieur et structure": {
			"Terrain : pente vers la maison, zones détrempées, clôtures et limites", "Orientation du jardin",
			"Porte d'entrée : isolation, serrure multipoints, joints",
			"Y a-t-il un puits, une récupération d'eau de pluie, un arrosage automatique ?",
		},
		"Cuisine": {
			"Prises suffisantes au-dessus du plan de travail", "Hotte",
			"Place pour lave-vaisselle, frigo américain, congélateur",
			"Plaques au gaz ou à l'électricité ? Arrivée de gaz possible ?",
			"Peut-on ouvrir la cuisine sur le séjour (mur porteur ou non) ?",
		},
		"Salon / séjour": {
			"Volume : surface et hauteur sous plafond", "Cheminée ou poêle",
			"La cheminée ou le poêle fonctionne-t-il ? Dernier ramonage (attestation) ?", "Quels murs sont porteurs ?",
		},
		"Salle de bain": {
			"Sèche-serviettes et prises loin des points d'eau", "L'eau est-elle calcaire ? Y a-t-il un adoucisseur ?",
		},
		"Toilettes": {"Lave-mains", "Y a-t-il une pompe de relevage ou un broyeur (sanibroyeur) ?"},
		"Garage": {
			"Le garage est-il compté dans la surface habitable ? Peut-il être transformé en pièce ?",
			"Y a-t-il d'autres places de stationnement ?",
			"La chaudière, le ballon d'eau chaude ou le tableau électrique sont-ils ici ?",
		},
		"Combles":                     {"Combles : isolant, fuites sous toiture, charpente", "Les combles ont-ils été isolés ? Avec quoi et quand ?"},
		"Cave, buanderie, chaufferie": {"Y a-t-il des panneaux solaires ? Contrat de revente, production annuelle ?"},
	}
	for _, s := range tpl.Sections {
		var got []string
		for _, p := range s.Points {
			if !p.Important {
				got = append(got, p.Label)
			}
		}
		for _, q := range s.Questions {
			if !q.Important {
				got = append(got, q.Text)
			}
		}
		if !slices.Equal(got, wantSecondary[s.Name]) {
			t.Errorf("%s : secondaires = %q, attendu %q", s.Name, got, wantSecondary[s.Name])
		}
	}
}

func labels(points []model.TemplatePoint) []string {
	out := []string{}
	for _, p := range points {
		out = append(out, p.Label)
	}
	return out
}

func texts(questions []model.TemplateQuestion) []string {
	out := []string{}
	for _, q := range questions {
		out = append(out, q.Text)
	}
	return out
}
