package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/mgarnier-home/visite/model"
)

// State renvoie l'état de la visite pour l'appareil. since = 0 : toutes les lignes ;
// sinon seulement celles dont seq > since. Les notes et commentaires des autres
// appareils ne sont jamais renvoyés. Tout est lu dans une seule transaction, de sorte
// que l'instantané et seq sont cohérents. ErrNotFound si la visite n'existe pas ou si
// l'appareil n'en est pas participant.
func (s *Store) State(ctx context.Context, code, device string, since int64) (model.VisitState, error) {
	st := model.VisitState{
		Rooms: []model.Room{}, Points: []model.Point{}, Questions: []model.Question{},
		Shared: []model.SharedValue{}, Ratings: []model.Rating{}, Comments: []model.Comment{},
		Photos: []model.Photo{},
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return st, err
	}
	defer tx.Rollback()

	if err := readVisitInfo(ctx, tx, code, device, &st); err != nil {
		return st, err
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT number FROM participants WHERE visit_code = ? AND device_id = ?`, code, device).Scan(&st.Me.Number); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return st, ErrNotFound
		}
		return st, err
	}

	if st.Rooms, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Room, error) {
		var v model.Room
		return v, r.Scan(&v.ID, &v.Name, &v.DirName, &v.Kind, &v.Position, &v.Hidden)
	}, `SELECT id, name, dir_name, kind, position, hidden FROM visit_rooms
		WHERE visit_code = ? AND seq > ? ORDER BY position`, code, since); err != nil {
		return st, err
	}

	if st.Points, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Point, error) {
		var v model.Point
		var options string
		if err := r.Scan(&v.ID, &v.RoomID, &v.Label, &v.Type, &options, &v.Weight, &v.Position); err != nil {
			return v, err
		}
		v.Options = []string{}
		if err := json.Unmarshal([]byte(options), &v.Options); err != nil {
			return v, fmt.Errorf("options du point %s: %w", v.ID, err)
		}
		if v.Options == nil {
			v.Options = []string{}
		}
		return v, nil
	}, `SELECT p.id, p.room_id, p.label, p.type, p.options, p.weight, p.position
		FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id
		WHERE r.visit_code = ? AND p.seq > ? ORDER BY r.position, p.position`, code, since); err != nil {
		return st, err
	}

	if st.Questions, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Question, error) {
		var v model.Question
		return v, r.Scan(&v.ID, &v.RoomID, &v.Text, &v.Position)
	}, `SELECT q.id, q.room_id, q.text, q.position
		FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id
		WHERE r.visit_code = ? AND q.seq > ? ORDER BY r.position, q.position`, code, since); err != nil {
		return st, err
	}

	// target_id peut désigner un point, une question ou une pièce de la visite.
	if st.Shared, err = queryAll(ctx, tx, func(r *sql.Rows) (model.SharedValue, error) {
		var v model.SharedValue
		var raw string
		var author sql.NullInt64
		if err := r.Scan(&v.TargetID, &v.Field, &raw, &v.UpdatedAt, &author); err != nil {
			return v, err
		}
		v.Author = int(author.Int64)
		if err := json.Unmarshal([]byte(raw), &v.Value); err != nil {
			return v, fmt.Errorf("valeur partagée %s/%s: %w", v.TargetID, v.Field, err)
		}
		return v, nil
	}, `SELECT sv.target_id, sv.field, sv.value, sv.updated_at, pa.number
		FROM shared_values sv
		LEFT JOIN participants pa ON pa.visit_code = ? AND pa.device_id = sv.device_id
		WHERE sv.seq > ? AND sv.target_id IN (
			SELECT ? -- notes de la visite
			UNION SELECT id FROM visit_rooms WHERE visit_code = ?
			UNION SELECT p.id FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id WHERE r.visit_code = ?
			UNION SELECT q.id FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id WHERE r.visit_code = ?)
		ORDER BY sv.target_id, sv.field`, code, since, code, code, code, code); err != nil {
		return st, err
	}

	if st.Ratings, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Rating, error) {
		var v model.Rating
		return v, r.Scan(&v.PointID, &v.Value, &v.UpdatedAt)
	}, `SELECT rt.point_id, rt.value, rt.updated_at
		FROM ratings rt
		JOIN visit_points p ON p.id = rt.point_id JOIN visit_rooms r ON r.id = p.room_id
		WHERE r.visit_code = ? AND rt.device_id = ? AND rt.seq > ?
		ORDER BY rt.point_id`, code, device, since); err != nil {
		return st, err
	}

	if st.Comments, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Comment, error) {
		var v model.Comment
		return v, r.Scan(&v.RoomID, &v.Text, &v.UpdatedAt)
	}, `SELECT c.room_id, c.text, c.updated_at
		FROM room_comments c JOIN visit_rooms r ON r.id = c.room_id
		WHERE r.visit_code = ? AND c.device_id = ? AND c.seq > ?
		ORDER BY c.room_id`, code, device, since); err != nil {
		return st, err
	}

	if st.Photos, err = queryAll(ctx, tx, func(r *sql.Rows) (model.Photo, error) {
		var v model.Photo
		var author sql.NullInt64
		if err := r.Scan(&v.ID, &v.RoomID, &author, &v.TakenAt); err != nil {
			return v, err
		}
		v.Author = int(author.Int64)
		return v, nil
	}, `SELECT ph.id, ph.room_id, pa.number, ph.taken_at
		FROM photos ph
		LEFT JOIN participants pa ON pa.visit_code = ph.visit_code AND pa.device_id = ph.device_id
		WHERE ph.visit_code = ? AND ph.seq > ?
		ORDER BY ph.seq, ph.id`, code, since); err != nil {
		return st, err
	}

	return st, nil
}

// readVisitInfo remplit Seq et Visit (fiche, clôture, liste de départ, participants).
func readVisitInfo(ctx context.Context, tx *sql.Tx, code, device string, st *model.VisitState) error {
	var creator string
	var closedAt sql.NullString
	f := &st.Visit.Fiche
	err := tx.QueryRowContext(ctx,
		`SELECT seq, creator_device_id, created_at, closed_at, packing_list,
			(SELECT COUNT(*) FROM participants WHERE visit_code = visits.code), `+strings.Join(ficheColumns, ", ")+`
		 FROM visits WHERE code = ?`, code).Scan(
		&st.Seq, &creator, &st.Visit.CreatedAt, &closedAt, &st.Visit.PackingList, &st.Visit.Participants,
		&f.Address, &f.PriceEUR, &f.LivingAreaM2, &f.FloorAreaM2, &f.LandAreaM2, &f.VisitAt,
		&f.AgentName, &f.AgentPhone, &f.AgentEmail, &f.ConstructionYear, &f.DPEEnergy, &f.DPEGES,
		&f.RoomsCount, &f.BedroomsCount, &f.ListingURL, &f.HeatingType)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	st.Visit.Code = code
	st.Visit.IsCreator = creator == device
	if closedAt.Valid {
		st.Visit.ClosedAt = &closedAt.String
	}
	return nil
}

// queryAll exécute la requête et renvoie toutes ses lignes, jamais nil.
func queryAll[T any](ctx context.Context, tx *sql.Tx, scan func(*sql.Rows) (T, error), query string, args ...any) ([]T, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return []T{}, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return []T{}, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
