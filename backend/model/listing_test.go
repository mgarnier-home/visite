package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestListingJSON(t *testing.T) {
	b, err := json.Marshal(Listing{ID: "a", ListingData: ListingData{PriceEUR: ptr(1.0)}})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"id":"a"`, `"price_eur":1`, `"features":[]`, `"photos":[]`, `"living_area_m2":null`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("%s absent de %s", want, b)
		}
	}
}
