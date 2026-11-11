package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mgarnier-home/visite/model"
)

// listingColumns : colonnes lues pour une annonce, dans l'ordre de scanListing.
const listingColumns = `id, source, url, status, created_at, mail_sent_at, visit_at, visited_at,
	fetched_at, removed_at, fetch_error, address, notes, title, property_type, price_eur,
	living_area_m2, land_area_m2, rooms, bedrooms, bathrooms, shower_rooms, toilets, parking,
	floor, construction_year, dpe, ges, heating, city, postal_code, description, agency,
	agent_phone, agent_email, features`

type rowScanner interface{ Scan(dest ...any) error }

func scanListing(r rowScanner) (model.Listing, error) {
	var l model.Listing
	var features string
	err := r.Scan(&l.ID, &l.Source, &l.URL, &l.Status, &l.CreatedAt, &l.MailSentAt, &l.VisitAt,
		&l.VisitedAt, &l.FetchedAt, &l.RemovedAt, &l.FetchError, &l.Address, &l.Notes, &l.Title,
		&l.PropertyType, &l.PriceEUR, &l.LivingAreaM2, &l.LandAreaM2, &l.Rooms, &l.Bedrooms,
		&l.Bathrooms, &l.ShowerRooms, &l.Toilets, &l.Parking, &l.Floor, &l.ConstructionYear,
		&l.DPE, &l.GES, &l.Heating, &l.City, &l.PostalCode, &l.Description, &l.Agency,
		&l.AgentPhone, &l.AgentEmail, &features)
	if err != nil {
		return l, err
	}
	if err := json.Unmarshal([]byte(features), &l.Features); err != nil {
		return l, err
	}
	l.Photos = []model.ListingPhoto{}
	return l, nil
}

// CreateListing enregistre l'annonce et crée sa visite (copie du modèle courant ; une
// chambre par section per_bedroom et par chambre de l'annonce, aucune si elle n'est pas
// indiquée). id, created_at et le statut « contact » sont fixés ici s'ils sont vides.
// ErrConflict si l'URL est déjà suivie.
func (s *Store) CreateListing(ctx context.Context, l model.Listing, raw json.RawMessage, now time.Time) (model.Listing, error) {
	l.ID = uuid.NewString()
	ts := now.UTC().Format(time.RFC3339)
	l.CreatedAt = ts
	if l.Status == "" {
		l.Status = model.StatusContact
	}
	features, err := json.Marshal(append([]string{}, l.Features...))
	if err != nil {
		return l, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return l, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `INSERT INTO listings (`+listingColumns+`, raw)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.ID, l.Source, l.URL, l.Status, l.CreatedAt, l.MailSentAt, l.VisitAt, l.VisitedAt,
		l.FetchedAt, l.RemovedAt, l.FetchError, l.Address, l.Notes, l.Title, l.PropertyType,
		l.PriceEUR, l.LivingAreaM2, l.LandAreaM2, l.Rooms, l.Bedrooms, l.Bathrooms, l.ShowerRooms,
		l.Toilets, l.Parking, l.Floor, l.ConstructionYear, l.DPE, l.GES, l.Heating, l.City,
		l.PostalCode, l.Description, l.Agency, l.AgentPhone, l.AgentEmail, string(features), string(raw)); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed: listings.url") {
			return l, ErrConflict
		}
		return l, err
	}

	tpl, err := readTemplate(ctx, tx)
	if err != nil {
		return l, err
	}
	const seq int64 = 1
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO visits (code, created_at, packing_list, seq_changed, seq) VALUES (?, ?, ?, 0, ?)`,
		l.ID, ts, tpl.PackingList, seq); err != nil {
		return l, err
	}
	bedrooms := 0
	if l.Bedrooms != nil {
		bedrooms = *l.Bedrooms
	}
	position := 0
	for _, sec := range tpl.Sections {
		names := []string{sec.Name}
		if sec.Kind == model.KindPerBedroom {
			names = names[:0]
			for n := 1; n <= bedrooms; n++ {
				names = append(names, sec.Name+" "+strconv.Itoa(n))
			}
		}
		for _, name := range names {
			if err := copySection(tx, l.ID, sec, uuid.NewString(), name, position, seq, ""); err != nil {
				return l, err
			}
			position++
		}
	}
	if err := tx.Commit(); err != nil {
		return l, err
	}
	l.Features = append([]string{}, l.Features...)
	l.Photos = []model.ListingPhoto{}
	return l, nil
}

// ListingIDByURL renvoie l'id de l'annonce de cette URL ; ErrNotFound si elle n'est pas suivie.
func (s *Store) ListingIDByURL(ctx context.Context, url string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM listings WHERE url = ?`, url).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// GetListing renvoie l'annonce avec ses photos triées ; ErrNotFound si elle n'existe pas.
func (s *Store) GetListing(ctx context.Context, id string) (model.Listing, error) {
	return getListing(ctx, s.db, id)
}

func getListing(ctx context.Context, q querier, id string) (model.Listing, error) {
	l, err := scanListing(q.QueryRowContext(ctx, `SELECT `+listingColumns+` FROM listings WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return l, ErrNotFound
	}
	if err != nil {
		return l, err
	}
	rows, err := q.QueryContext(ctx,
		`SELECT id, position FROM listing_photos WHERE listing_id = ? ORDER BY position`, id)
	if err != nil {
		return l, err
	}
	defer rows.Close()
	for rows.Next() {
		var p model.ListingPhoto
		if err := rows.Scan(&p.ID, &p.Position); err != nil {
			return l, err
		}
		l.Photos = append(l.Photos, p)
	}
	return l, rows.Err()
}

// ListListings renvoie les annonces, la plus récente d'abord, chacune avec ses photos.
func (s *Store) ListListings(ctx context.Context) ([]model.Listing, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+listingColumns+` FROM listings ORDER BY created_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Listing{}
	byID := map[string]int{}
	for rows.Next() {
		l, err := scanListing(rows)
		if err != nil {
			return nil, err
		}
		byID[l.ID] = len(out)
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	prows, err := s.db.QueryContext(ctx, `SELECT listing_id, id, position FROM listing_photos ORDER BY position`)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var lid string
		var p model.ListingPhoto
		if err := prows.Scan(&lid, &p.ID, &p.Position); err != nil {
			return nil, err
		}
		i := byID[lid]
		out[i].Photos = append(out[i].Photos, p)
	}
	return out, prows.Err()
}

// DeleteListing supprime l'annonce, sa visite et ses photos en base ; ErrNotFound si elle
// n'existe pas. Les valeurs partagées n'ont pas de clé étrangère : elles sont retirées ici.
// Les fichiers sont à la charge de l'appelant.
func (s *Store) DeleteListing(ctx context.Context, id string) error {
	return s.InTx(ctx, func(t *Tx) error {
		if _, err := t.tx.ExecContext(ctx, `DELETE FROM shared_values WHERE target_id IN (
				SELECT id FROM visit_rooms WHERE visit_code = ?1
				UNION SELECT p.id FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id WHERE r.visit_code = ?1
				UNION SELECT q.id FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id WHERE r.visit_code = ?1)`,
			id); err != nil {
			return err
		}
		res, err := t.tx.ExecContext(ctx, `DELETE FROM listings WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// AddListingPhoto ajoute une photo en dernière position ; ErrConflict si sourceURL est déjà là.
func (s *Store) AddListingPhoto(ctx context.Context, listingID, sourceURL, path string, size int64) (string, error) {
	id := uuid.NewString()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO listing_photos (id, listing_id, position, source_url, path, size)
		 SELECT ?, ?, COALESCE(MAX(position), -1) + 1, ?, ?, ? FROM listing_photos WHERE listing_id = ?`,
		id, listingID, sourceURL, path, size, listingID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: listing_photos.listing_id") {
		return "", ErrConflict
	}
	return id, err
}

// ListingPhotoURLs renvoie les URL d'origine des photos déjà enregistrées.
func (s *Store) ListingPhotoURLs(ctx context.Context, listingID string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT source_url FROM listing_photos WHERE listing_id = ?`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out[u] = true
	}
	return out, rows.Err()
}

// ListingPhotoPath renvoie le chemin relatif de la photo ; ErrNotFound si elle n'est pas à l'annonce.
func (s *Store) ListingPhotoPath(ctx context.Context, listingID, photoID string) (string, error) {
	var path string
	err := s.db.QueryRowContext(ctx,
		`SELECT path FROM listing_photos WHERE id = ? AND listing_id = ?`, photoID, listingID).Scan(&path)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return path, err
}
