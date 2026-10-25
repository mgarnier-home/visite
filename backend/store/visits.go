package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mgarnier-home/visite/model"
)

// VisitExists indique si une visite existe avec ce code.
func (s *Store) VisitExists(ctx context.Context, code string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM visits WHERE code = ?`, code).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// CreateVisit crée la visite, copie le modèle courant (instantané) et inscrit
// l'appareil créateur comme participant 1. Erreurs : model.ErrInvalid, ErrConflict.
func (s *Store) CreateVisit(ctx context.Context, code string, f model.Fiche, creatorDevice string, now time.Time) error {
	if !model.ValidCode(code) {
		return fmt.Errorf("%w: code de visite invalide", model.ErrInvalid)
	}
	if err := f.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	tpl, err := readTemplate(ctx, tx)
	if err != nil {
		return err
	}
	ts := now.UTC().Format(time.RFC3339)
	const seq int64 = 1
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO visits (code, creator_device_id, created_at, address, price_eur, living_area_m2,
			floor_area_m2, land_area_m2, visit_at, agent_name, agent_phone, agent_email,
			construction_year, dpe_energy, dpe_ges, rooms_count, bedrooms_count, listing_url,
			heating_type, packing_list, fiche_ts, seq_changed, seq)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
		code, creatorDevice, ts, f.Address, f.PriceEUR, f.LivingAreaM2, f.FloorAreaM2, f.LandAreaM2,
		f.VisitAt, f.AgentName, f.AgentPhone, f.AgentEmail, f.ConstructionYear, f.DPEEnergy, f.DPEGES,
		f.RoomsCount, f.BedroomsCount, f.ListingURL, f.HeatingType, tpl.PackingList, seq, seq); err != nil {
		if isUniqueViolation(err) {
			return ErrConflict
		}
		return err
	}

	bedrooms := 0
	if f.BedroomsCount != nil {
		bedrooms = *f.BedroomsCount
	}
	position := 0
	for _, sec := range tpl.Sections {
		if sec.Kind == model.KindPerBedroom {
			for i := 1; i <= bedrooms; i++ {
				name := sec.Name + " " + strconv.Itoa(i)
				if err := copySection(tx, code, sec, uuid.NewString(), name, position, seq); err != nil {
					return err
				}
				position++
			}
			continue
		}
		if err := copySection(tx, code, sec, uuid.NewString(), sec.Name, position, seq); err != nil {
			return err
		}
		position++
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO participants (visit_code, device_id, number, joined_at) VALUES (?, ?, 1, ?)`,
		code, creatorDevice, ts); err != nil {
		return err
	}
	return tx.Commit()
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: visits.code")
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
