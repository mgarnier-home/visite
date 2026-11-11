package scrape

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
)

const jinkaUUID = "51989b63-6a16-4d88-b963-1971b4e65103"

func fetchJinka(t *testing.T, body []byte, status int) (Result, error) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ad/"+jinkaUUID {
			t.Errorf("chemin = %s", r.URL.Path)
		}
		if r.Header.Get("User-Agent") != "visite/test" {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		w.WriteHeader(status)
		w.Write(body)
	}))
	defer srv.Close()
	c := &Client{UserAgent: "visite/test", JinkaBase: srv.URL}
	return c.Fetch(context.Background(), SourceJinka, "https://www.jinka.fr/ad/"+jinkaUUID)
}

func TestJinkaFetch(t *testing.T) {
	body, err := os.ReadFile("testdata/jinka-ad.html")
	if err != nil {
		t.Fatal(err)
	}
	res, err := fetchJinka(t, body, 200)
	if err != nil {
		t.Fatal(err)
	}
	d := res.Data
	if d.PriceEUR == nil || *d.PriceEUR != 313500 || d.LivingAreaM2 == nil || *d.LivingAreaM2 != 150 ||
		d.LandAreaM2 == nil || *d.LandAreaM2 != 522 {
		t.Errorf("prix/surfaces : %v %v %v", d.PriceEUR, d.LivingAreaM2, d.LandAreaM2)
	}
	if d.Rooms == nil || *d.Rooms != 8 || d.Bedrooms == nil || *d.Bedrooms != 5 || d.Floor == nil || *d.Floor != 0 {
		t.Errorf("pièces : %v %v %v", d.Rooms, d.Bedrooms, d.Floor)
	}
	if d.PropertyType != "Maison" || d.City != "Thouare-Sur-Loire" || d.PostalCode != "44470" || d.DPE != "D" || d.GES != "D" {
		t.Errorf("texte : %+v", d)
	}
	for _, f := range []string{"garden", "garage"} {
		if !slices.Contains(d.Features, f) {
			t.Errorf("Features %v sans %s", d.Features, f)
		}
	}
	if d.Description == "" {
		t.Error("description vide")
	}
	if !strings.HasPrefix(d.Title, "Maison 8 pièces 150 m² à vendre") || strings.Contains(d.Title, "Jinka") {
		t.Errorf("Title = %q", d.Title)
	}
	if len(res.PhotoURLs) == 0 {
		t.Fatal("aucune photo")
	}
	for _, u := range res.PhotoURLs {
		if !strings.HasPrefix(u, "https://") {
			t.Errorf("photo non https : %s", u)
		}
	}
	if !strings.Contains(string(res.Raw), `"source_label"`) {
		t.Error("Raw ne contient pas l'objet d'annonce")
	}
}

func TestJinkaPriceFromTitle(t *testing.T) {
	page := `<title>Maison - 313 500 € | Jinka</title><script>self.__next_f.push([1,"{\"id\":\"1\",\"rent\":null,\"source_label\":\"x\"}"])</script>`
	res, err := fetchJinka(t, []byte(page), 200)
	if err != nil {
		t.Fatal(err)
	}
	if res.Data.PriceEUR == nil || *res.Data.PriceEUR != 313500 {
		t.Errorf("prix = %v", res.Data.PriceEUR)
	}
}

func TestJinkaFormat(t *testing.T) {
	for _, page := range []string{
		`<html><title>Jinka</title><body>rien</body></html>`,
		`<title>Maison | Jinka</title><script>self.__next_f.push([1,"{\"id\":\"1\",\"rent\":null,\"source_label\":\"x\"}"])</script>`, // sans prix
	} {
		if _, err := fetchJinka(t, []byte(page), 200); !errors.Is(err, ErrFormat) {
			t.Errorf("err = %v, voulu ErrFormat", err)
		}
	}
}

func TestJinkaRemoved(t *testing.T) {
	if _, err := fetchJinka(t, nil, 404); !errors.Is(err, ErrRemoved) {
		t.Errorf("err = %v, voulu ErrRemoved", err)
	}
}
