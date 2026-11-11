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

// VisitInfo : Code est l'id de l'annonce.
type VisitInfo struct {
	Code         string `json:"code"`
	CreatedAt    string `json:"created_at"`
	PackingList  string `json:"packing_list"`
	Participants int    `json:"participants"`
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
