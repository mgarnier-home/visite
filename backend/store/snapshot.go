package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/mgarnier-home/visite/model"
)

// globalNoteLabel est le libellé du point « note » ajouté en tête de chaque pièce.
const globalNoteLabel = "Note globale de la pièce"

// uniqueDirName renvoie base, ou base-2, base-3… si le dossier existe déjà dans la visite.
func uniqueDirName(tx *sql.Tx, code, base string) (string, error) {
	for i := 1; ; i++ {
		name := base
		if i > 1 {
			name = base + "-" + strconv.Itoa(i)
		}
		var n int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM visit_rooms WHERE visit_code = ? AND dir_name = ?`, code, name).Scan(&n); err != nil {
			return "", err
		}
		if n == 0 {
			return name, nil
		}
	}
}

// copySection crée la pièce roomID d'après la section du modèle : la pièce elle-même,
// la note globale (sections room et per_bedroom), puis les points et questions copiés.
// Toutes les lignes insérées portent seq.
func copySection(tx *sql.Tx, code string, sec model.TemplateSection, roomID, name string, position int, seq int64) error {
	dir, err := uniqueDirName(tx, code, model.Slugify(name))
	if err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT INTO visit_rooms (id, visit_code, name, dir_name, kind, position, hidden, seq)
		 VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		roomID, code, name, dir, string(sec.Kind), position, seq); err != nil {
		return fmt.Errorf("pièce %q: %w", name, err)
	}

	offset := 0
	if sec.Kind == model.KindRoom || sec.Kind == model.KindPerBedroom {
		if _, err := tx.Exec(
			`INSERT INTO visit_points (id, room_id, label, type, options, weight, position, seq)
			 VALUES (?, ?, ?, ?, '[]', 1, 0, ?)`,
			uuid.NewString(), roomID, globalNoteLabel, string(model.TypeNote), seq); err != nil {
			return err
		}
		offset = 1
	}
	for i, p := range sec.Points {
		opts := p.Options
		if opts == nil {
			opts = []string{}
		}
		ob, err := json.Marshal(opts)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO visit_points (id, room_id, label, type, options, weight, position, seq)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.NewString(), roomID, p.Label, string(p.Type), string(ob), p.Weight, i+offset, seq); err != nil {
			return err
		}
	}
	for _, q := range sec.Questions {
		if _, err := tx.Exec(
			`INSERT INTO visit_questions (id, room_id, text, position, seq) VALUES (?, ?, ?, ?, ?)`,
			uuid.NewString(), roomID, q.Text, q.Position, seq); err != nil {
			return err
		}
	}
	return nil
}
