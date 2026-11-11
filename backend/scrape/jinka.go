package scrape

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/mgarnier-home/visite/model"
)

var (
	jinkaChunkRe = regexp.MustCompile(`self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)`)
	jinkaTitleRe = regexp.MustCompile(`<title>([^<]*)</title>`)
	jinkaPriceRe = regexp.MustCompile(`([\d\s\x{a0}\x{202f}]+)€`)
)

type jinkaAd struct {
	Rent        *float64 `json:"rent"`
	Area        *float64 `json:"area"`
	LandArea    *float64 `json:"land_area"`
	Room        *int     `json:"room"`
	Bedroom     *int     `json:"bedroom"`
	Floor       *int     `json:"floor"`
	DPE         string   `json:"energy_dpe"`
	GES         string   `json:"energy_ges"`
	City        string   `json:"city"`
	PostalCode  string   `json:"postal_code"`
	Description string   `json:"description"`
	Type        string   `json:"type"`
	Features    struct {
		Lift, Shower, Bath, Parking, Balcony, Terracy, Cave, Garden, Pool, Fireplace *bool
	} `json:"features"`
}

func (c *Client) fetchJinka(ctx context.Context, link string) (Result, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Result{}, err
	}
	body, err := c.getBody(ctx, orBase(c.JinkaBase, "https://www.jinka.fr")+"/ad/"+url.PathEscape(path.Base(u.Path)))
	if err != nil {
		return Result{}, err
	}
	page := string(body)

	// Charge utile React Server Components : chaînes JSON mises bout à bout.
	var flight strings.Builder
	for _, m := range jinkaChunkRe.FindAllStringSubmatch(page, -1) {
		var chunk string
		if json.Unmarshal([]byte(m[1]), &chunk) == nil {
			flight.WriteString(chunk)
		}
	}
	s := flight.String()
	end := strings.Index(s, `"source_label"`)
	start := strings.LastIndex(s[:max(end, 0)], `{"id":`)
	if end < 0 || start < 0 {
		return Result{}, fmt.Errorf("%w : objet d'annonce introuvable", ErrFormat)
	}
	var raw json.RawMessage
	if err := json.NewDecoder(strings.NewReader(s[start:])).Decode(&raw); err != nil {
		return Result{}, fmt.Errorf("%w : %v", ErrFormat, err)
	}
	var ad jinkaAd
	if err := json.Unmarshal(raw, &ad); err != nil {
		return Result{}, fmt.Errorf("%w : %v", ErrFormat, err)
	}

	// Les images sont dans un autre fragment : l'objet d'annonce n'en a qu'une référence.
	photos := []string{}
	if i := strings.Index(s, `"images":[`); i >= 0 {
		var imgs []string
		if json.NewDecoder(strings.NewReader(s[i+len(`"images":`):])).Decode(&imgs) == nil {
			for _, img := range imgs {
				if strings.HasPrefix(img, "https://") {
					photos = append(photos, img)
				}
			}
		}
	}

	title := ""
	if m := jinkaTitleRe.FindStringSubmatch(page); m != nil {
		title = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(m[1]), "| Jinka"))
	}
	price := ad.Rent
	if price == nil {
		price = priceFromTitle(title)
	}
	if price == nil {
		return Result{}, fmt.Errorf("%w : prix absent", ErrFormat)
	}

	features := []string{}
	for _, f := range []struct {
		name string
		on   *bool
	}{
		{"garden", ad.Features.Garden}, {"terrace", ad.Features.Terracy}, {"balcony", ad.Features.Balcony},
		{"pool", ad.Features.Pool}, {"cellar", ad.Features.Cave}, {"fireplace", ad.Features.Fireplace},
		{"elevator", ad.Features.Lift}, {"garage", ad.Features.Parking},
	} {
		if f.on != nil && *f.on {
			features = append(features, f.name)
		}
	}
	return Result{
		Data: model.ListingData{
			Title: title, PropertyType: ad.Type, PriceEUR: price, LivingAreaM2: ad.Area, LandAreaM2: ad.LandArea,
			Rooms: ad.Room, Bedrooms: ad.Bedroom, Floor: ad.Floor, DPE: ad.DPE, GES: ad.GES,
			City: ad.City, PostalCode: ad.PostalCode, Description: ad.Description, Features: features,
		},
		PhotoURLs: photos,
		Raw:       raw,
	}, nil
}

// priceFromTitle lit « … - 313 500 € » (espaces, y compris insécables).
func priceFromTitle(title string) *float64 {
	m := jinkaPriceRe.FindStringSubmatch(title)
	if m == nil {
		return nil
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, m[1])
	f, err := strconv.ParseFloat(digits, 64)
	if err != nil {
		return nil
	}
	return &f
}
