package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/mgarnier-home/visite/model"
)

// GetTemplate renvoie le modèle global ; les listes ne sont jamais nil.
func (s *Store) GetTemplate(ctx context.Context) (model.Template, error) {
	// Transaction de lecture : snapshot WAL cohérent pour les quatre requêtes.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return model.Template{}, err
	}
	defer tx.Rollback()
	return readTemplate(ctx, tx)
}

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func readTemplate(ctx context.Context, q querier) (model.Template, error) {
	t := model.Template{Sections: []model.TemplateSection{}}
	if err := q.QueryRowContext(ctx, `SELECT version, packing_list FROM template WHERE id = 1`).
		Scan(&t.Version, &t.PackingList); err != nil {
		return t, err
	}
	idx := map[string]int{}

	rows, err := q.QueryContext(ctx, `SELECT id, name, kind, position FROM template_sections ORDER BY position, id`)
	if err != nil {
		return t, err
	}
	for rows.Next() {
		sec := model.TemplateSection{Points: []model.TemplatePoint{}, Questions: []model.TemplateQuestion{}}
		if err := rows.Scan(&sec.ID, &sec.Name, &sec.Kind, &sec.Position); err != nil {
			rows.Close()
			return t, err
		}
		idx[sec.ID] = len(t.Sections)
		t.Sections = append(t.Sections, sec)
	}
	if err := closeRows(rows); err != nil {
		return t, err
	}

	rows, err = q.QueryContext(ctx,
		`SELECT id, section_id, label, type, options, weight, position, important FROM template_points ORDER BY position, id`)
	if err != nil {
		return t, err
	}
	for rows.Next() {
		var p model.TemplatePoint
		var sectionID, options string
		if err := rows.Scan(&p.ID, &sectionID, &p.Label, &p.Type, &options, &p.Weight, &p.Position, &p.Important); err != nil {
			rows.Close()
			return t, err
		}
		p.Options = []string{}
		if err := json.Unmarshal([]byte(options), &p.Options); err != nil {
			rows.Close()
			return t, fmt.Errorf("options du point %s: %w", p.ID, err)
		}
		if p.Options == nil {
			p.Options = []string{}
		}
		i, ok := idx[sectionID]
		if !ok {
			rows.Close()
			return t, fmt.Errorf("point %s: section %s introuvable", p.ID, sectionID)
		}
		t.Sections[i].Points = append(t.Sections[i].Points, p)
	}
	if err := closeRows(rows); err != nil {
		return t, err
	}

	rows, err = q.QueryContext(ctx,
		`SELECT id, section_id, text, position, important FROM template_questions ORDER BY position, id`)
	if err != nil {
		return t, err
	}
	for rows.Next() {
		var tq model.TemplateQuestion
		var sectionID string
		if err := rows.Scan(&tq.ID, &sectionID, &tq.Text, &tq.Position, &tq.Important); err != nil {
			rows.Close()
			return t, err
		}
		i, ok := idx[sectionID]
		if !ok {
			rows.Close()
			return t, fmt.Errorf("question %s: section %s introuvable", tq.ID, sectionID)
		}
		t.Sections[i].Questions = append(t.Sections[i].Questions, tq)
	}
	return t, closeRows(rows)
}

type rowsCloser interface {
	Err() error
	Close() error
}

func closeRows(r rowsCloser) error {
	if err := r.Err(); err != nil {
		r.Close()
		return err
	}
	return r.Close()
}

// SaveTemplate remplace tout le modèle si t.Version est la version courante,
// et renvoie le modèle avec Version+1.
func (s *Store) SaveTemplate(ctx context.Context, t model.Template) (model.Template, error) {
	if err := t.Validate(); err != nil {
		return model.Template{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.Template{}, err
	}
	defer tx.Rollback()

	// UPDATE conditionnel en premier : prend le verrou d'écriture et évite
	// toute course entre la lecture de la version et son incrément.
	res, err := tx.ExecContext(ctx,
		`UPDATE template SET version = version + 1, packing_list = ? WHERE id = 1 AND version = ?`,
		t.PackingList, t.Version)
	if err != nil {
		return model.Template{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return model.Template{}, err
	}
	if n == 0 {
		return model.Template{}, ErrVersionConflict
	}
	for _, table := range []string{"template_questions", "template_points", "template_sections"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table); err != nil {
			return model.Template{}, err
		}
	}
	for _, sec := range t.Sections {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO template_sections (id, name, kind, position) VALUES (?, ?, ?, ?)`,
			sec.ID, sec.Name, sec.Kind, sec.Position); err != nil {
			return model.Template{}, err
		}
		for _, p := range sec.Points {
			opts := p.Options
			if opts == nil {
				opts = []string{}
			}
			ob, err := json.Marshal(opts)
			if err != nil {
				return model.Template{}, err
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO template_points (id, section_id, label, type, options, weight, position, important)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				p.ID, sec.ID, p.Label, p.Type, string(ob), p.Weight, p.Position, p.Important); err != nil {
				return model.Template{}, err
			}
		}
		for _, q := range sec.Questions {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO template_questions (id, section_id, text, position, important) VALUES (?, ?, ?, ?, ?)`,
				q.ID, sec.ID, q.Text, q.Position, q.Important); err != nil {
				return model.Template{}, err
			}
		}
	}
	// Relecture dans la même transaction : on renvoie ce qui vient d'être écrit.
	saved, err := readTemplate(ctx, tx)
	if err != nil {
		return model.Template{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.Template{}, err
	}
	return saved, nil
}

// SeedTemplateIfEmpty installe t comme modèle initial s'il n'existe aucune section.
func (s *Store) SeedTemplateIfEmpty(ctx context.Context, t model.Template) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM template_sections`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	cur, err := s.GetTemplate(ctx)
	if err != nil {
		return err
	}
	t.Version = cur.Version
	_, err = s.SaveTemplate(ctx, t)
	return err
}
