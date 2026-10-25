package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/mgarnier-home/visite/export"
	"github.com/mgarnier-home/visite/model"
)

// ExportData lit tout ce qu'il faut à l'export CSV : notes et commentaires de tous les
// participants, indexés par numéro. Year reste à zéro (le store n'a pas d'horloge ; l'appelant
// le renseigne). Lecture dans une seule transaction. ErrNotFound si la visite est inconnue.
func (s *Store) ExportData(ctx context.Context, code string) (export.Data, error) {
	d := export.Data{
		Code:      code,
		Rooms:     []model.Room{},
		Points:    []model.Point{},
		Questions: []model.Question{},
		Shared:    map[string]map[string]json.RawMessage{},
		Ratings:   map[string]map[int]*int{},
		Comments:  map[string]map[int]string{},
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return d, err
	}
	defer tx.Rollback()

	var st model.VisitState
	if err := readVisitInfo(ctx, tx, code, "", &st); err != nil {
		return d, err
	}
	d.Fiche = st.Visit.Fiche
	d.Participants = st.Visit.Participants

	if d.Rooms, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Room, error) {
		var v model.Room
		return v, r.Scan(&v.ID, &v.Name, &v.DirName, &v.Kind, &v.Position, &v.Hidden)
	}, `SELECT id, name, dir_name, kind, position, hidden FROM visit_rooms
		WHERE visit_code = ? ORDER BY position`, code); err != nil {
		return d, err
	}

	if d.Points, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Point, error) {
		var v model.Point
		var options string
		if err := r.Scan(&v.ID, &v.RoomID, &v.Label, &v.Type, &options, &v.Weight, &v.Position); err != nil {
			return v, err
		}
		v.Options = []string{}
		if err := json.Unmarshal([]byte(options), &v.Options); err != nil {
			return v, fmt.Errorf("options du point %s: %w", v.ID, err)
		}
		return v, nil
	}, `SELECT p.id, p.room_id, p.label, p.type, p.options, p.weight, p.position
		FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id
		WHERE r.visit_code = ? ORDER BY r.position, p.position`, code); err != nil {
		return d, err
	}

	if d.Questions, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Question, error) {
		var v model.Question
		return v, r.Scan(&v.ID, &v.RoomID, &v.Text, &v.Position)
	}, `SELECT q.id, q.room_id, q.text, q.position
		FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id
		WHERE r.visit_code = ? ORDER BY r.position, q.position`, code); err != nil {
		return d, err
	}

	type sharedRow struct {
		target, field, value string
	}
	shared, err := queryAll(ctx, tx, func(r *sql.Rows) (sharedRow, error) {
		var v sharedRow
		return v, r.Scan(&v.target, &v.field, &v.value)
	}, `SELECT target_id, field, value FROM shared_values WHERE target_id IN (
			SELECT id FROM visit_rooms WHERE visit_code = ?
			UNION SELECT p.id FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id WHERE r.visit_code = ?
			UNION SELECT q.id FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id WHERE r.visit_code = ?)`,
		code, code, code)
	if err != nil {
		return d, err
	}
	for _, v := range shared {
		if d.Shared[v.target] == nil {
			d.Shared[v.target] = map[string]json.RawMessage{}
		}
		d.Shared[v.target][v.field] = json.RawMessage(v.value)
	}

	type ratingRow struct {
		point  string
		number int
		value  *int
	}
	ratings, err := queryAll(ctx, tx, func(r *sql.Rows) (ratingRow, error) {
		var v ratingRow
		return v, r.Scan(&v.point, &v.number, &v.value)
	}, `SELECT rt.point_id, pa.number, rt.value
		FROM ratings rt
		JOIN visit_points p ON p.id = rt.point_id JOIN visit_rooms r ON r.id = p.room_id
		JOIN participants pa ON pa.visit_code = r.visit_code AND pa.device_id = rt.device_id
		WHERE r.visit_code = ?`, code)
	if err != nil {
		return d, err
	}
	for _, v := range ratings {
		if d.Ratings[v.point] == nil {
			d.Ratings[v.point] = map[int]*int{}
		}
		d.Ratings[v.point][v.number] = v.value
	}

	type commentRow struct {
		room   string
		number int
		text   string
	}
	comments, err := queryAll(ctx, tx, func(r *sql.Rows) (commentRow, error) {
		var v commentRow
		return v, r.Scan(&v.room, &v.number, &v.text)
	}, `SELECT c.room_id, pa.number, c.text
		FROM room_comments c JOIN visit_rooms r ON r.id = c.room_id
		JOIN participants pa ON pa.visit_code = r.visit_code AND pa.device_id = c.device_id
		WHERE r.visit_code = ?`, code)
	if err != nil {
		return d, err
	}
	for _, v := range comments {
		if d.Comments[v.room] == nil {
			d.Comments[v.room] = map[int]string{}
		}
		d.Comments[v.room][v.number] = v.text
	}
	return d, nil
}
