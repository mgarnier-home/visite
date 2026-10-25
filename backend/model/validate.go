package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
)

// ErrInvalid est enveloppée par toutes les erreurs de validation.
var ErrInvalid = errors.New("invalid")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

var codeRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`)

// ValidCode indique si le code de visite est acceptable.
func ValidCode(code string) bool { return codeRe.MatchString(code) }

// Validate vérifie la cohérence du modèle de visite.
func (t Template) Validate() error {
	sectionIDs := map[string]bool{}
	pointIDs := map[string]bool{}
	questionIDs := map[string]bool{}
	for _, s := range t.Sections {
		if err := claimID(sectionIDs, "section", s.ID); err != nil {
			return err
		}
		switch s.Kind {
		case KindRoom, KindPerBedroom, KindTopic, KindSummary:
		default:
			return invalid("section %q : kind inconnu %q", s.ID, s.Kind)
		}
		for _, q := range s.Questions {
			if err := claimID(questionIDs, "question", q.ID); err != nil {
				return err
			}
		}
		for _, p := range s.Points {
			if err := claimID(pointIDs, "point", p.ID); err != nil {
				return err
			}
			switch p.Type {
			case TypeConstat:
				if len(p.Options) == 0 {
					return invalid("point %q : un constat exige des options", p.ID)
				}
			case TypeNote, TypeCase:
				if len(p.Options) > 0 {
					return invalid("point %q : options interdites pour le type %q", p.ID, p.Type)
				}
			default:
				return invalid("point %q : type inconnu %q", p.ID, p.Type)
			}
			if !(p.Weight > 0) {
				return invalid("point %q : le poids doit être > 0", p.ID)
			}
		}
	}
	return nil
}

// claimID vérifie qu'un identifiant est non vide et pas encore utilisé, puis le réserve.
func claimID(seen map[string]bool, what, id string) error {
	if id == "" {
		return invalid("%s : identifiant vide", what)
	}
	if seen[id] {
		return invalid("%s %q : identifiant en double", what, id)
	}
	seen[id] = true
	return nil
}

var dpeLetters = []string{"A", "B", "C", "D", "E", "F", "G"}

// Validate vérifie les champs de la fiche (seule l'adresse est obligatoire).
func (f Fiche) Validate() error {
	if strings.TrimSpace(f.Address) == "" {
		return invalid("adresse obligatoire")
	}
	for name, v := range map[string]*float64{
		"price_eur": f.PriceEUR, "living_area_m2": f.LivingAreaM2,
		"floor_area_m2": f.FloorAreaM2, "land_area_m2": f.LandAreaM2,
	} {
		if v != nil && (*v < 0 || math.IsNaN(*v) || math.IsInf(*v, 0)) {
			return invalid("%s doit être un nombre >= 0", name)
		}
	}
	for name, v := range map[string]*string{"dpe_energy": f.DPEEnergy, "dpe_ges": f.DPEGES} {
		if v != nil && !slices.Contains(dpeLetters, *v) {
			return invalid("%s doit être une lettre de A à G", name)
		}
	}
	if f.RoomsCount != nil && *f.RoomsCount < 0 {
		return invalid("rooms_count doit être >= 0")
	}
	if f.BedroomsCount != nil && (*f.BedroomsCount < 0 || *f.BedroomsCount > 20) {
		return invalid("bedrooms_count doit être entre 0 et 20")
	}
	return nil
}

// TargetKind désigne le type de cible d'une valeur partagée.
type TargetKind int

const (
	TargetPoint TargetKind = iota
	TargetQuestion
	TargetRoom
)

// ValidSharedValue vérifie qu'une valeur partagée est permise pour la cible.
// p n'est non nil que pour TargetPoint (type et options du point).
func ValidSharedValue(target TargetKind, p *Point, field string, raw json.RawMessage) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return invalid("valeur nulle interdite pour %q", field)
	}
	switch {
	case target == TargetPoint && field == "value":
		if p == nil {
			return invalid("point requis pour %q", field)
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return invalid("%q doit être un texte", field)
		}
		switch p.Type {
		case TypeCase:
			if s == "ok" || s == "problem" || s == "na" {
				return nil
			}
		case TypeConstat:
			if s == "na" || slices.Contains(p.Options, s) {
				return nil
			}
		default:
			return invalid("%q n'est pas permis pour un point de type %q", field, p.Type)
		}
		return invalid("valeur %q inconnue", s)
	case (target == TargetPoint && field == "blocking"),
		(target == TargetQuestion && field == "asked"):
		var b bool
		if err := json.Unmarshal(raw, &b); err != nil {
			return invalid("%q doit être un booléen", field)
		}
		return nil
	case target == TargetPoint && field == "works_eur":
		var n float64
		if err := json.Unmarshal(raw, &n); err != nil || n < 0 || n != math.Trunc(n) {
			return invalid("%q doit être un entier >= 0", field)
		}
		return nil
	case target == TargetQuestion && field == "answer":
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return invalid("%q doit être un texte", field)
		}
		return nil
	case target == TargetRoom && field == "area_m2":
		var n float64
		if err := json.Unmarshal(raw, &n); err != nil || n < 0 {
			return invalid("%q doit être un nombre >= 0", field)
		}
		return nil
	}
	return invalid("champ %q non permis pour cette cible", field)
}
