package scrape

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"testing"
)

const bieniciID = "hektor-agenceduplateau-2935"

func bieniciServer(t *testing.T, body []byte, status int) (*Client, *http.Request) {
	t.Helper()
	got := new(http.Request)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*got = *r
		w.WriteHeader(status)
		w.Write(body)
	}))
	t.Cleanup(srv.Close)
	return &Client{UserAgent: "visite/test", BieniciBase: srv.URL}, got
}

func fetchBienici(c *Client) (Result, error) {
	return c.Fetch(context.Background(), SourceBienici, "https://www.bienici.com/annonce/vente/saint-front/maison/3pieces/"+bieniciID)
}

func TestBieniciFetch(t *testing.T) {
	body, err := os.ReadFile("testdata/bienici-ad.json")
	if err != nil {
		t.Fatal(err)
	}
	c, req := bieniciServer(t, body, 200)
	res, err := fetchBienici(c)
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.Path != "/realEstateAd.json" || req.URL.Query().Get("id") != bieniciID {
		t.Errorf("requête = %s", req.URL)
	}
	if req.Header.Get("User-Agent") != "visite/test" {
		t.Errorf("User-Agent = %q", req.Header.Get("User-Agent"))
	}
	d := res.Data
	if d.PriceEUR == nil || *d.PriceEUR != 100000 || d.LivingAreaM2 == nil || *d.LivingAreaM2 != 375 ||
		d.LandAreaM2 == nil || *d.LandAreaM2 != 4500 {
		t.Errorf("prix/surfaces : %v %v %v", d.PriceEUR, d.LivingAreaM2, d.LandAreaM2)
	}
	if d.Rooms == nil || *d.Rooms != 3 || d.Bedrooms == nil || *d.Bedrooms != 2 || d.Bathrooms != nil {
		t.Errorf("pièces : %v %v %v", d.Rooms, d.Bedrooms, d.Bathrooms)
	}
	if d.ConstructionYear == nil || *d.ConstructionYear != 1900 {
		t.Errorf("année = %v", d.ConstructionYear)
	}
	if d.PropertyType != "house" || d.DPE != "NS" || d.GES != "NS" || d.City != "Saint-Front" || d.PostalCode != "43550" ||
		d.Title != "Corps de ferme isolé à rénover vue imprenable sur lac" || d.Description == "" ||
		d.Agency != "Maurin Immobilier - DODILLON Christine" || d.AgentPhone != "0620401056" {
		t.Errorf("texte : %+v", d)
	}
	if !slices.Equal(d.Features, []string{"garden"}) {
		t.Errorf("Features = %v", d.Features)
	}
	if len(res.PhotoURLs) != 12 || res.PhotoURLs[0] != "https://file.bienici.com/photo/hektor-agenceduplateau-2935_d52a3f7b62700bc3c569b6f40f03bac2.jpg" {
		t.Errorf("photos : %d %v", len(res.PhotoURLs), res.PhotoURLs[:1])
	}
	if string(res.Raw) != string(body) {
		t.Error("Raw différent du corps reçu")
	}
}

func TestBieniciYearZeroAndArrayPrice(t *testing.T) {
	c, _ := bieniciServer(t, []byte(`{"price":[90000,null],"yearOfConstruction":0}`), 200)
	res, err := fetchBienici(c)
	if err != nil {
		t.Fatal(err)
	}
	if res.Data.ConstructionYear != nil {
		t.Errorf("année = %v, voulu nil", *res.Data.ConstructionYear)
	}
	if res.Data.PriceEUR == nil || *res.Data.PriceEUR != 90000 {
		t.Errorf("prix = %v", res.Data.PriceEUR)
	}
	if res.Data.Features == nil || res.PhotoURLs == nil {
		t.Error("Features et PhotoURLs ne doivent pas être nil")
	}
}

func TestBieniciRemoved(t *testing.T) {
	for _, status := range []int{404, 410} {
		c, _ := bieniciServer(t, nil, status)
		if _, err := fetchBienici(c); !errors.Is(err, ErrRemoved) {
			t.Errorf("%d : err = %v, voulu ErrRemoved", status, err)
		}
	}
}

func TestBieniciFormat(t *testing.T) {
	for _, body := range []string{`{}`, `pas du json`} {
		c, _ := bieniciServer(t, []byte(body), 200)
		if _, err := fetchBienici(c); !errors.Is(err, ErrFormat) {
			t.Errorf("%q : err = %v, voulu ErrFormat", body, err)
		}
	}
	c, _ := bieniciServer(t, nil, 500)
	if _, err := fetchBienici(c); err == nil || errors.Is(err, ErrRemoved) {
		t.Errorf("500 : err = %v", err)
	}
}
