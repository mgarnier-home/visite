package scrape

import "testing"

func TestFindURL(t *testing.T) {
	tests := []struct {
		name, text, source, url string
		ok                      bool
	}{
		{"Jinka partagé", "Regarde https://www.jinka.fr/ad/51989b63-6a16-4d88-b963-1971b4e65103?alert_id=104e576b347e609a11411b9356f035f6&utm_source=jinka_app&utm_medium=share&utm_campaign=ad_share",
			"jinka", "https://www.jinka.fr/ad/51989b63-6a16-4d88-b963-1971b4e65103", true},
		{"Leboncoin partagé", "J'ai trouvé une annonce qui devrait vous intéresser sur leboncoin\n\n https://www.leboncoin.fr/ad/ventes_immobilieres/3306963410",
			"manual", "https://www.leboncoin.fr/ad/ventes_immobilieres/3306963410", true},
		{"Bien'ici avec requête", "https://www.bienici.com/annonce/vente/vertou/maison/5pieces/century-21-202_750_27604?q=%2Fx#photos",
			"bienici", "https://www.bienici.com/annonce/vente/vertou/maison/5pieces/century-21-202_750_27604", true},
		{"sous-domaine bienici sans www", "voir https://bienici.com/annonce/x/y/abc.", "bienici", "https://bienici.com/annonce/x/y/abc", true},
		{"parenthèse finale", "(https://www.jinka.fr/ad/abc)", "jinka", "https://www.jinka.fr/ad/abc", true},
		{"http seul ignoré", "http://www.bienici.com/annonce/a", "", "", false},
		{"aucun lien", "Maison 5 pièces", "", "", false},
		{"faux domaine", "https://bienici.com.evil.fr/annonce/a", "manual", "https://bienici.com.evil.fr/annonce/a", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source, url, ok := FindURL(tt.text)
			if source != tt.source || url != tt.url || ok != tt.ok {
				t.Errorf("FindURL = (%q, %q, %v), voulu (%q, %q, %v)", source, url, ok, tt.source, tt.url, tt.ok)
			}
		})
	}
}

func TestCleanURLErrors(t *testing.T) {
	for _, raw := range []string{"http://a.fr/x", "https://", "pas un lien"} {
		if _, err := CleanURL(raw); err == nil {
			t.Errorf("CleanURL(%q) devrait échouer", raw)
		}
	}
}
