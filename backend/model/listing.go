package model

import "encoding/json"

// ListingStatus est l'étape de suivi d'une annonce.
type ListingStatus string

const (
	StatusContact ListingStatus = "contact"
	StatusMail    ListingStatus = "mail"
	StatusPlanned ListingStatus = "planned"
	StatusDone    ListingStatus = "done"
	StatusDropped ListingStatus = "dropped"
)

// ListingData regroupe les caractéristiques d'une annonce, celles que la
// récupération remplit et qu'une correction manuelle peut modifier.
type ListingData struct {
	Title        string   `json:"title"`
	PropertyType string   `json:"property_type"`
	PriceEUR     *float64 `json:"price_eur"`
	LivingAreaM2 *float64 `json:"living_area_m2"`
	LandAreaM2   *float64 `json:"land_area_m2"`

	Rooms            *int `json:"rooms"`
	Bedrooms         *int `json:"bedrooms"`
	Bathrooms        *int `json:"bathrooms"`
	ShowerRooms      *int `json:"shower_rooms"`
	Toilets          *int `json:"toilets"`
	Parking          *int `json:"parking"`
	Floor            *int `json:"floor"`
	ConstructionYear *int `json:"construction_year"`

	DPE         string `json:"dpe"`
	GES         string `json:"ges"`
	Heating     string `json:"heating"`
	City        string `json:"city"`
	PostalCode  string `json:"postal_code"`
	Description string `json:"description"`
	Agency      string `json:"agency"`
	AgentPhone  string `json:"agent_phone"`
	AgentEmail  string `json:"agent_email"`

	// Features : garden, terrace, balcony, pool, cellar, fireplace, elevator, garage.
	Features []string `json:"features"`
}

// ListingPhoto référence une photo stockée de l'annonce.
type ListingPhoto struct {
	ID       string `json:"id"`
	Position int    `json:"position"`
}

// Listing est une annonce suivie. Les dates sont des chaînes RFC 3339.
type Listing struct {
	ID     string        `json:"id"`
	Source string        `json:"source"`
	URL    string        `json:"url"`
	Status ListingStatus `json:"status"`

	CreatedAt  string  `json:"created_at"`
	MailSentAt *string `json:"mail_sent_at"`
	VisitAt    *string `json:"visit_at"`
	VisitedAt  *string `json:"visited_at"`
	FetchedAt  *string `json:"fetched_at"`
	RemovedAt  *string `json:"removed_at"`

	FetchError string `json:"fetch_error"`
	Address    string `json:"address"`
	Notes      string `json:"notes"`

	ListingData
	Photos []ListingPhoto `json:"photos"`
}

// MarshalJSON garantit des listes vides plutôt que null pour features et photos.
func (l Listing) MarshalJSON() ([]byte, error) {
	type plain Listing // sans méthodes : évite la récursion
	if l.Features == nil {
		l.Features = []string{}
	}
	if l.Photos == nil {
		l.Photos = []ListingPhoto{}
	}
	return json.Marshal(plain(l))
}
