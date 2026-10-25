package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// PhotoRecord : une photo enregistrée. RoomID nil : photo globale.
// Path est relatif à la racine du stockage ; TakenAt garde le décalage du téléphone.
type PhotoRecord struct {
	ID        string
	VisitCode string
	RoomID    *string
	DeviceID  string
	TakenAt   time.Time
	Path      string
	Size      int64
}

// AddPhoto enregistre la photo et incrémente le seq de la visite. Idempotent par id :
// created est faux, sans aucun changement, si l'id existe déjà. ErrClosed si la visite
// est clôturée, ErrNotFound si elle est inconnue ou si la pièce n'en fait pas partie.
func (s *Store) AddPhoto(ctx context.Context, p PhotoRecord) (created bool, err error) {
	err = s.InTx(ctx, func(t *Tx) error {
		v, err := t.Visit(p.VisitCode)
		if err != nil {
			return err
		}
		if v.Closed {
			return ErrClosed
		}
		var existing string
		err = t.tx.QueryRowContext(ctx, `SELECT visit_code FROM photos WHERE id = ?`, p.ID).Scan(&existing)
		switch {
		case err == nil:
			if existing != p.VisitCode {
				return ErrConflict
			}
			return nil
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		if p.RoomID != nil {
			_, code, err := t.Room(*p.RoomID)
			if err != nil {
				return err
			}
			if code != p.VisitCode {
				return ErrNotFound
			}
		}
		seq, err := t.NextSeq(p.VisitCode)
		if err != nil {
			return err
		}
		if _, err := t.tx.ExecContext(ctx,
			`INSERT INTO photos (id, visit_code, room_id, device_id, taken_at, path, size, seq)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			p.ID, p.VisitCode, p.RoomID, p.DeviceID, p.TakenAt.Format(time.RFC3339), p.Path, p.Size, seq); err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return created, nil
}

// PhotoPathByID renvoie le chemin relatif de la photo ; ErrNotFound si elle n'est pas
// dans cette visite.
func (s *Store) PhotoPathByID(ctx context.Context, code, id string) (string, error) {
	var path string
	err := s.db.QueryRowContext(ctx,
		`SELECT path FROM photos WHERE id = ? AND visit_code = ?`, id, code).Scan(&path)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return path, err
}

// RoomDirName renvoie le dossier de la pièce ; ErrNotFound si elle n'est pas dans cette visite.
func (s *Store) RoomDirName(ctx context.Context, code, roomID string) (string, error) {
	var dir string
	err := s.db.QueryRowContext(ctx,
		`SELECT dir_name FROM visit_rooms WHERE id = ? AND visit_code = ?`, roomID, code).Scan(&dir)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return dir, err
}
