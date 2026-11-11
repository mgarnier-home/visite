package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// VisitExists indique si une visite existe avec ce code.
func (s *Store) VisitExists(ctx context.Context, code string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM visits WHERE code = ?`, code).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// Join inscrit l'appareil à la visite et renvoie son numéro ; idempotent.
func (s *Store) Join(ctx context.Context, code, device string, now time.Time) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM visits WHERE code = ?`, code).Scan(&exists); err != nil {
		return 0, err
	}
	if exists == 0 {
		return 0, ErrNotFound
	}

	var number int
	err = tx.QueryRowContext(ctx,
		`SELECT number FROM participants WHERE visit_code = ? AND device_id = ?`, code, device).Scan(&number)
	if err == nil {
		return number, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(number), 0) + 1 FROM participants WHERE visit_code = ?`, code).Scan(&number); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO participants (visit_code, device_id, number, joined_at) VALUES (?, ?, ?, ?)`,
		code, device, number, now.UTC().Format(time.RFC3339)); err != nil {
		return 0, err
	}
	return number, tx.Commit()
}

// ParticipantNumber renvoie le numéro de l'appareil ; ErrNotFound s'il n'est pas participant.
func (s *Store) ParticipantNumber(ctx context.Context, code, device string) (int, error) {
	var number int
	err := s.db.QueryRowContext(ctx,
		`SELECT number FROM participants WHERE visit_code = ? AND device_id = ?`, code, device).Scan(&number)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return number, err
}
