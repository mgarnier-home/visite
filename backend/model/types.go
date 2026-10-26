// Package model contient le modèle du domaine : types du contrat JSON,
// validation et calculs. Aucune dépendance à la base ou à HTTP.
package model

type SectionKind string

const (
	KindRoom       SectionKind = "room"
	KindPerBedroom SectionKind = "per_bedroom"
	KindTopic      SectionKind = "topic"
	KindSummary    SectionKind = "summary"
)

type PointType string

const (
	TypeNote    PointType = "note"
	TypeConstat PointType = "constat"
	TypeCase    PointType = "case"
)

type Template struct {
	Version     int               `json:"version"`
	PackingList string            `json:"packing_list"`
	Sections    []TemplateSection `json:"sections"`
}

type TemplateSection struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Kind      SectionKind        `json:"kind"`
	Position  int                `json:"position"`
	Points    []TemplatePoint    `json:"points"`
	Questions []TemplateQuestion `json:"questions"`
}

type TemplatePoint struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	Type      PointType `json:"type"`
	Options   []string  `json:"options"`
	Weight    float64   `json:"weight"`
	Position  int       `json:"position"`
	Important bool      `json:"important"`
}

type TemplateQuestion struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	Position  int    `json:"position"`
	Important bool   `json:"important"`
}

type Fiche struct {
	Address          string   `json:"address"`
	PriceEUR         *float64 `json:"price_eur"`
	LivingAreaM2     *float64 `json:"living_area_m2"`
	FloorAreaM2      *float64 `json:"floor_area_m2"`
	LandAreaM2       *float64 `json:"land_area_m2"`
	VisitAt          *string  `json:"visit_at"`
	AgentName        *string  `json:"agent_name"`
	AgentPhone       *string  `json:"agent_phone"`
	AgentEmail       *string  `json:"agent_email"`
	ConstructionYear *int     `json:"construction_year"`
	DPEEnergy        *string  `json:"dpe_energy"`
	DPEGES           *string  `json:"dpe_ges"`
	RoomsCount       *int     `json:"rooms_count"`
	BedroomsCount    *int     `json:"bedrooms_count"`
	ListingURL       *string  `json:"listing_url"`
	HeatingType      *string  `json:"heating_type"`
}

type VisitInfo struct {
	Code         string  `json:"code"`
	IsCreator    bool    `json:"is_creator"`
	CreatedAt    string  `json:"created_at"`
	ClosedAt     *string `json:"closed_at"`
	Fiche        Fiche   `json:"fiche"`
	PackingList  string  `json:"packing_list"`
	Participants int     `json:"participants"`
}

type Room struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	DirName  string      `json:"dir_name"`
	Kind     SectionKind `json:"kind"`
	Position int         `json:"position"`
	Hidden   bool        `json:"hidden"`
}

// Point : Important = affiché par défaut dans sa pièce ; sinon point secondaire.
type Point struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	Label     string    `json:"label"`
	Type      PointType `json:"type"`
	Options   []string  `json:"options"`
	Weight    float64   `json:"weight"`
	Position  int       `json:"position"`
	Important bool      `json:"important"`
}

type Question struct {
	ID        string `json:"id"`
	RoomID    string `json:"room_id"`
	Text      string `json:"text"`
	Position  int    `json:"position"`
	Important bool   `json:"important"`
}

// SharedValue : Author est le numéro du participant.
type SharedValue struct {
	TargetID  string `json:"target_id"`
	Field     string `json:"field"`
	Value     any    `json:"value"`
	UpdatedAt int64  `json:"updated_at"`
	Author    int    `json:"author"`
}

type Rating struct {
	PointID   string `json:"point_id"`
	Value     *int   `json:"value"`
	UpdatedAt int64  `json:"updated_at"`
}

type Comment struct {
	RoomID    string `json:"room_id"`
	Text      string `json:"text"`
	UpdatedAt int64  `json:"updated_at"`
}

type Photo struct {
	ID      string  `json:"id"`
	RoomID  *string `json:"room_id"`
	Author  int     `json:"author"`
	TakenAt string  `json:"taken_at"`
}

// Me : identité de l'appareil dans la visite.
type Me struct {
	Number int `json:"number"`
}

type VisitState struct {
	Seq       int64         `json:"seq"`
	Me        Me            `json:"me"`
	Visit     VisitInfo     `json:"visit"`
	Rooms     []Room        `json:"rooms"`
	Points    []Point       `json:"points"`
	Questions []Question    `json:"questions"`
	Shared    []SharedValue `json:"shared"`
	Ratings   []Rating      `json:"ratings"`
	Comments  []Comment     `json:"comments"`
	Photos    []Photo       `json:"photos"`
}
