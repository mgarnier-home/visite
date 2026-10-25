package model

import (
	"math"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const maxSlugLen = 60

// Slugify produit un nom de dossier : minuscules, sans accents, tirets.
func Slugify(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range norm.NFD.String(strings.ToLower(name)) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			dash = false
			b.WriteRune(r)
		} else {
			dash = true
		}
	}
	s := b.String()
	if len(s) > maxSlugLen {
		s = strings.TrimRight(s[:maxSlugLen], "-")
	}
	if s == "" {
		return "piece"
	}
	return s
}

// NotaryFees : frais de notaire estimés à 7,5 % du prix.
func NotaryFees(price float64) float64 { return price * 0.075 }

// PricePerM2 : prix au m² habitable, nil si prix ou surface manquants.
func PricePerM2(f Fiche) *float64 {
	if f.PriceEUR == nil || f.LivingAreaM2 == nil || *f.LivingAreaM2 <= 0 {
		return nil
	}
	v := *f.PriceEUR / *f.LivingAreaM2
	return &v
}

// WeightedScore : moyenne pondérée des notes (sur 5), arrondie au dixième.
// Seuls les points de type note comptent ; les N/A (nil) sont exclus.
func WeightedScore(points []Point, ratings map[string]*int) *float64 {
	var sum, weights float64
	for _, p := range points {
		if p.Type != TypeNote {
			continue
		}
		r := ratings[p.ID]
		if r == nil {
			continue
		}
		sum += float64(*r) * p.Weight
		weights += p.Weight
	}
	if weights == 0 {
		return nil
	}
	v := math.Round(sum/weights*10) / 10
	return &v
}
