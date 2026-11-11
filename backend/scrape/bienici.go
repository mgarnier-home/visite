package scrape

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path"

	"github.com/mgarnier-home/visite/model"
)

type bieniciAd struct {
	Price              any      `json:"price"` // nombre, ou [prix, prix barré]
	PropertyType       string   `json:"propertyType"`
	Rooms              *int     `json:"roomsQuantity"`
	Bedrooms           *int     `json:"bedroomsQuantity"`
	Bathrooms          *int     `json:"bathroomsQuantity"`
	ShowerRooms        *int     `json:"showerRoomsQuantity"`
	Toilets            *int     `json:"toiletQuantity"`
	SurfaceArea        *float64 `json:"surfaceArea"`
	LandSurfaceArea    *float64 `json:"landSurfaceArea"`
	Parking            *int     `json:"parkingPlacesQuantity"`
	Floor              *int     `json:"floor"`
	YearOfConstruction *int     `json:"yearOfConstruction"`
	Energy             string   `json:"energyClassification"`
	GES                string   `json:"greenhouseGazClassification"`
	Heating            any      `json:"heating"`
	City               string   `json:"city"`
	PostalCode         string   `json:"postalCode"`
	Description        string   `json:"description"`
	Title              string   `json:"title"`
	HasGarden          bool     `json:"hasGarden"`
	HasPool            bool     `json:"hasPool"`
	HasElevator        bool     `json:"hasElevator"`
	Terraces           int      `json:"terracesQuantity"`
	Balconies          int      `json:"balconyQuantity"`
	Cellars            int      `json:"cellarsOrUndergroundsQuantity"`
	FirePlaces         int      `json:"firePlacesQuantity"`
	Photos             []struct {
		URL string `json:"url"`
	} `json:"photos"`
	ContactRelativeData struct {
		Name  string `json:"contactNameToDisplay"`
		Phone string `json:"phoneToDisplay"`
	} `json:"contactRelativeData"`
}

func (c *Client) fetchBienici(ctx context.Context, link string) (Result, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Result{}, err
	}
	id := path.Base(u.Path)
	body, err := c.getBody(ctx, orBase(c.BieniciBase, "https://www.bienici.com")+"/realEstateAd.json?id="+url.QueryEscape(id))
	if err != nil {
		return Result{}, err
	}
	var ad bieniciAd
	if err := json.Unmarshal(body, &ad); err != nil {
		return Result{}, fmt.Errorf("%w : %v", ErrFormat, err)
	}
	price := firstNumber(ad.Price)
	if price == nil {
		return Result{}, fmt.Errorf("%w : prix absent", ErrFormat)
	}
	heating, _ := ad.Heating.(string)
	if ad.YearOfConstruction != nil && *ad.YearOfConstruction == 0 {
		ad.YearOfConstruction = nil
	}
	features := []string{}
	for _, f := range []struct {
		name string
		on   bool
	}{
		{"garden", ad.HasGarden}, {"terrace", ad.Terraces > 0}, {"balcony", ad.Balconies > 0},
		{"pool", ad.HasPool}, {"cellar", ad.Cellars > 0}, {"fireplace", ad.FirePlaces > 0},
		{"elevator", ad.HasElevator},
	} {
		if f.on {
			features = append(features, f.name)
		}
	}
	photos := []string{}
	for _, p := range ad.Photos {
		if p.URL != "" {
			photos = append(photos, p.URL)
		}
	}
	return Result{
		Data: model.ListingData{
			Title: ad.Title, PropertyType: ad.PropertyType, PriceEUR: price,
			LivingAreaM2: ad.SurfaceArea, LandAreaM2: ad.LandSurfaceArea,
			Rooms: ad.Rooms, Bedrooms: ad.Bedrooms, Bathrooms: ad.Bathrooms, ShowerRooms: ad.ShowerRooms,
			Toilets: ad.Toilets, Parking: ad.Parking, Floor: ad.Floor, ConstructionYear: ad.YearOfConstruction,
			DPE: ad.Energy, GES: ad.GES, Heating: heating, City: ad.City, PostalCode: ad.PostalCode,
			Description: ad.Description, Agency: ad.ContactRelativeData.Name, AgentPhone: ad.ContactRelativeData.Phone,
			Features: features,
		},
		PhotoURLs: photos,
		Raw:       body,
	}, nil
}

// firstNumber lit un prix donné en nombre ou en tableau (premier élément).
func firstNumber(v any) *float64 {
	if a, ok := v.([]any); ok && len(a) > 0 {
		v = a[0]
	}
	if f, ok := v.(float64); ok {
		return &f
	}
	return nil
}
