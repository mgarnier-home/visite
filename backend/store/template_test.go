package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mgarnier-home/visite/model"
)

func sampleTemplate() model.Template {
	return model.Template{
		PackingList: "mètre, lampe",
		Sections: []model.TemplateSection{
			{
				ID: "s2", Name: "Cuisine", Kind: model.KindRoom, Position: 1,
				Points: []model.TemplatePoint{
					{ID: "p2", Label: "Hotte", Type: model.TypeCase, Weight: 1, Position: 1},
					{ID: "p1", Label: "Sol", Type: model.TypeConstat, Options: []string{"carrelage", "parquet"}, Weight: 1, Position: 0},
				},
				Questions: []model.TemplateQuestion{
					{ID: "q2", Text: "Second ?", Position: 1},
					{ID: "q1", Text: "Premier ?", Position: 0},
				},
			},
			{ID: "s1", Name: "Entrée", Kind: model.KindRoom, Position: 0},
		},
	}
}

func TestOpenAppliesMigrationsOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m.db")
	for i := 0; i < 2; i++ {
		s, err := Open(path)
		if err != nil {
			t.Fatalf("Open #%d: %v", i, err)
		}
		if i == 1 {
			var n int
			if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if n != 2 {
				t.Fatalf("schema_migrations = %d lignes, attendu 2", n)
			}
		}
		s.Close()
	}
}

func TestTemplateEmptyByDefault(t *testing.T) {
	s := newTestStore(t)
	tpl, err := s.GetTemplate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if tpl.Version != 0 || tpl.Sections == nil || len(tpl.Sections) != 0 {
		t.Fatalf("modèle vide attendu, obtenu %+v", tpl)
	}
}

func TestSaveTemplateIncrementsVersion(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	saved, err := s.SaveTemplate(ctx, sampleTemplate())
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != 1 {
		t.Fatalf("version = %d, attendu 1", saved.Version)
	}
	got, gerr := s.GetTemplate(ctx)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if got.Version != 1 || got.PackingList != "mètre, lampe" {
		t.Fatalf("relu: %+v", got)
	}
	again, err := s.SaveTemplate(ctx, got)
	if err != nil || again.Version != 2 {
		t.Fatalf("seconde sauvegarde: %v %+v", err, again.Version)
	}
}

func TestSaveTemplateRejectsStaleVersion(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if _, err := s.SaveTemplate(ctx, sampleTemplate()); err != nil {
		t.Fatal(err)
	}
	_, err := s.SaveTemplate(ctx, sampleTemplate()) // version 0, périmée
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("err = %v, attendu ErrVersionConflict", err)
	}
}

func TestSaveTemplateRejectsInvalid(t *testing.T) {
	s := newTestStore(t)
	tpl := sampleTemplate()
	tpl.Sections[0].Points[1].Options = nil // constat sans options
	_, err := s.SaveTemplate(context.Background(), tpl)
	if !errors.Is(err, model.ErrInvalid) {
		t.Fatalf("err = %v, attendu model.ErrInvalid", err)
	}
}

func TestSaveTemplateKeepsOrder(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if _, err := s.SaveTemplate(ctx, sampleTemplate()); err != nil {
		t.Fatal(err)
	}
	got, gerr := s.GetTemplate(ctx)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if got.Sections[0].ID != "s1" || got.Sections[1].ID != "s2" {
		t.Fatalf("sections non triées: %+v", got.Sections)
	}
	k := got.Sections[1]
	if k.Points[0].ID != "p1" || k.Points[1].ID != "p2" {
		t.Fatalf("points non triés: %+v", k.Points)
	}
	if k.Questions[0].ID != "q1" || k.Questions[1].ID != "q2" {
		t.Fatalf("questions non triées: %+v", k.Questions)
	}
	if len(k.Points[0].Options) != 2 || k.Points[0].Options[1] != "parquet" {
		t.Fatalf("options: %+v", k.Points[0].Options)
	}
}

func TestGetTemplateListsNeverNil(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if _, err := s.SaveTemplate(ctx, sampleTemplate()); err != nil {
		t.Fatal(err)
	}
	got, gerr := s.GetTemplate(ctx)
	if gerr != nil {
		t.Fatal(gerr)
	}
	entree := got.Sections[0]
	if entree.Points == nil || entree.Questions == nil {
		t.Fatalf("listes nil: %+v", entree)
	}
	if opts := got.Sections[1].Points[1].Options; opts == nil || len(opts) != 0 {
		t.Fatalf("Options doit être un slice vide non nil, obtenu %#v", opts)
	}
}

func TestSeedTemplateIfEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if err := s.SeedTemplateIfEmpty(ctx, sampleTemplate()); err != nil {
		t.Fatal(err)
	}
	got, gerr := s.GetTemplate(ctx)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if got.Version != 1 || len(got.Sections) != 2 {
		t.Fatalf("seed: %+v", got)
	}
	other := sampleTemplate()
	other.Sections = other.Sections[:1]
	if err := s.SeedTemplateIfEmpty(ctx, other); err != nil {
		t.Fatal(err)
	}
	got, gerr = s.GetTemplate(ctx)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if got.Version != 1 || len(got.Sections) != 2 {
		t.Fatalf("le seed ne doit pas écraser: %+v", got)
	}
}

func TestTemplateQuestionImportantRoundTrip(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	tpl := model.Template{
		Sections: []model.TemplateSection{{
			ID: "s1", Name: "Cuisine", Kind: model.KindRoom, Position: 0,
			Questions: []model.TemplateQuestion{
				{ID: "q1", Text: "Importante ?", Position: 0, Important: true},
				{ID: "q2", Text: "Normale ?", Position: 1},
			},
		}},
	}
	saved, err := s.SaveTemplate(ctx, tpl)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetTemplate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, tp := range []model.Template{saved, got} {
		qs := tp.Sections[0].Questions
		if len(qs) != 2 || !qs[0].Important || qs[1].Important {
			t.Fatalf("questions = %+v", qs)
		}
	}
}
