package model

import (
	"math"
	"testing"
)

func TestNotaryFees(t *testing.T) {
	if got := NotaryFees(300000); math.Abs(got-22500) > 1e-9 {
		t.Errorf("NotaryFees(300000) = %v, want 22500", got)
	}
}

func TestPricePerM2(t *testing.T) {
	got := PricePerM2(Fiche{PriceEUR: ptr(300000.0), LivingAreaM2: ptr(120.0)})
	if got == nil || *got != 2500 {
		t.Errorf("PricePerM2 = %v, want 2500", got)
	}
	for name, f := range map[string]Fiche{
		"surface nulle":   {PriceEUR: ptr(300000.0), LivingAreaM2: ptr(0.0)},
		"surface absente": {PriceEUR: ptr(300000.0)},
		"prix absent":     {LivingAreaM2: ptr(120.0)},
	} {
		if got := PricePerM2(f); got != nil {
			t.Errorf("%s : PricePerM2 = %v, want nil", name, *got)
		}
	}
}

func TestWeightedScore(t *testing.T) {
	pts := []Point{
		{ID: "a", Type: TypeNote, Weight: 3},
		{ID: "b", Type: TypeNote, Weight: 1},
		{ID: "c", Type: TypeNote, Weight: 2},
		{ID: "d", Type: TypeCase, Weight: 5},
	}
	got := WeightedScore(pts, map[string]*int{"a": ptr(5), "b": ptr(3), "c": nil, "d": ptr(1)})
	if got == nil || *got != 4.5 {
		t.Errorf("score = %v, want 4.5", got)
	}
	if got := WeightedScore(pts, map[string]*int{"c": nil}); got != nil {
		t.Errorf("sans note : %v, want nil", *got)
	}
	if got := WeightedScore(pts, nil); got != nil {
		t.Errorf("ratings nil : %v, want nil", *got)
	}
	// 4.25 -> 4.3 : (5*1 + 4*3)/4 ... poids 1 et 3 -> (5+12)/4 = 4.25
	two := []Point{{ID: "x", Type: TypeNote, Weight: 1}, {ID: "y", Type: TypeNote, Weight: 3}}
	got = WeightedScore(two, map[string]*int{"x": ptr(5), "y": ptr(4)})
	if got == nil || *got != 4.3 {
		t.Errorf("arrondi = %v, want 4.3", got)
	}
}
