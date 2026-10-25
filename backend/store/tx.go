package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/mgarnier-home/visite/model"
)

// Tx est une transaction d'écriture : avec _txlock=immediate, elle détient le verrou
// d'écriture de la base dès son ouverture, ce qui sérialise les opérations concurrentes.
type Tx struct {
	ctx context.Context
	tx  *sql.Tx
}

// InTx exécute fn dans une transaction ; validée si fn renvoie nil, annulée sinon.
func (s *Store) InTx(ctx context.Context, fn func(*Tx) error) error {
	sqlTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer sqlTx.Rollback()
	if err := fn(&Tx{ctx: ctx, tx: sqlTx}); err != nil {
		return err
	}
	return sqlTx.Commit()
}

// VisitRow : ce qu'il faut savoir d'une visite pour appliquer une opération.
type VisitRow struct {
	Closed        bool
	CreatorDevice string
	Fiche         model.Fiche
	Seq           int64
}

// ficheColumns : champs de la fiche, identiques aux noms JSON et aux colonnes de visits.
var ficheColumns = []string{
	"address", "price_eur", "living_area_m2", "floor_area_m2", "land_area_m2", "visit_at",
	"agent_name", "agent_phone", "agent_email", "construction_year", "dpe_energy", "dpe_ges",
	"rooms_count", "bedrooms_count", "listing_url", "heating_type",
}

func isFicheColumn(name string) bool { return slices.Contains(ficheColumns, name) }

// Visit lit la visite ; ErrNotFound si elle n'existe pas.
func (t *Tx) Visit(code string) (VisitRow, error) {
	var v VisitRow
	var closedAt sql.NullString
	f := &v.Fiche
	err := t.tx.QueryRowContext(t.ctx,
		`SELECT closed_at, creator_device_id, seq, `+strings.Join(ficheColumns, ", ")+`
		 FROM visits WHERE code = ?`, code).Scan(
		&closedAt, &v.CreatorDevice, &v.Seq,
		&f.Address, &f.PriceEUR, &f.LivingAreaM2, &f.FloorAreaM2, &f.LandAreaM2, &f.VisitAt,
		&f.AgentName, &f.AgentPhone, &f.AgentEmail, &f.ConstructionYear, &f.DPEEnergy, &f.DPEGES,
		&f.RoomsCount, &f.BedroomsCount, &f.ListingURL, &f.HeatingType)
	if errors.Is(err, sql.ErrNoRows) {
		return VisitRow{}, ErrNotFound
	}
	if err != nil {
		return VisitRow{}, err
	}
	v.Closed = closedAt.Valid
	return v, nil
}

// OpRecord : une ligne du journal des opérations.
type OpRecord struct {
	OpID       string
	VisitCode  string
	DeviceID   string
	Type       string
	Payload    json.RawMessage
	ClientTS   int64
	ReceivedAt time.Time
	Result     string
}

// OpSeen indique si l'opération figure déjà dans le journal.
func (t *Tx) OpSeen(opID string) (bool, error) {
	var n int
	if err := t.tx.QueryRowContext(t.ctx, `SELECT COUNT(*) FROM ops WHERE op_id = ?`, opID).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// RecordOp inscrit l'opération au journal ; ErrConflict si op_id y figure déjà.
func (t *Tx) RecordOp(r OpRecord) error {
	payload := string(r.Payload)
	if len(r.Payload) == 0 {
		payload = "null"
	}
	_, err := t.tx.ExecContext(t.ctx,
		`INSERT INTO ops (op_id, visit_code, device_id, type, payload, client_ts, received_at, result)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.OpID, r.VisitCode, r.DeviceID, r.Type, payload, r.ClientTS, r.ReceivedAt.UnixMilli(), r.Result)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: ops.op_id") {
		return ErrConflict
	}
	return err
}

// NextSeq incrémente le compteur de la visite et renvoie sa nouvelle valeur.
func (t *Tx) NextSeq(code string) (int64, error) {
	var seq int64
	err := t.tx.QueryRowContext(t.ctx,
		`UPDATE visits SET seq = seq + 1 WHERE code = ? RETURNING seq`, code).Scan(&seq)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return seq, err
}

// Room renvoie la pièce et le code de sa visite ; ErrNotFound si elle n'existe pas.
func (t *Tx) Room(id string) (model.Room, string, error) {
	var r model.Room
	var code string
	err := t.tx.QueryRowContext(t.ctx,
		`SELECT id, name, dir_name, kind, position, hidden, visit_code FROM visit_rooms WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.DirName, &r.Kind, &r.Position, &r.Hidden, &code)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Room{}, "", ErrNotFound
	}
	return r, code, err
}

// Point renvoie le point et le code de sa visite ; ErrNotFound s'il n'existe pas.
func (t *Tx) Point(id string) (model.Point, string, error) {
	var p model.Point
	var code, options string
	err := t.tx.QueryRowContext(t.ctx,
		`SELECT p.id, p.room_id, p.label, p.type, p.options, p.weight, p.position, r.visit_code
		 FROM visit_points p JOIN visit_rooms r ON r.id = p.room_id WHERE p.id = ?`, id).
		Scan(&p.ID, &p.RoomID, &p.Label, &p.Type, &options, &p.Weight, &p.Position, &code)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Point{}, "", ErrNotFound
	}
	if err != nil {
		return model.Point{}, "", err
	}
	p.Options = []string{}
	if err := json.Unmarshal([]byte(options), &p.Options); err != nil {
		return model.Point{}, "", fmt.Errorf("options du point %s: %w", id, err)
	}
	if p.Options == nil {
		p.Options = []string{}
	}
	return p, code, nil
}

// Question renvoie la question et le code de sa visite ; ErrNotFound si elle n'existe pas.
func (t *Tx) Question(id string) (model.Question, string, error) {
	var q model.Question
	var code string
	err := t.tx.QueryRowContext(t.ctx,
		`SELECT q.id, q.room_id, q.text, q.position, r.visit_code
		 FROM visit_questions q JOIN visit_rooms r ON r.id = q.room_id WHERE q.id = ?`, id).
		Scan(&q.ID, &q.RoomID, &q.Text, &q.Position, &code)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Question{}, "", ErrNotFound
	}
	return q, code, err
}

// nextRoomPosition renvoie la position qui suit la dernière pièce de la visite.
func (t *Tx) nextRoomPosition(code string) (int, error) {
	var pos int
	err := t.tx.QueryRowContext(t.ctx,
		`SELECT COALESCE(MAX(position), -1) + 1 FROM visit_rooms WHERE visit_code = ?`, code).Scan(&pos)
	return pos, err
}

// InsertRoom ajoute en dernière position une pièce vide de kind room, avec sa note globale
// (d'id notePointID, ou généré si vide).
func (t *Tx) InsertRoom(code, roomID, name string, seq int64, notePointID string) error {
	pos, err := t.nextRoomPosition(code)
	if err != nil {
		return err
	}
	sec := model.TemplateSection{Kind: model.KindRoom}
	return copySection(t.tx, code, sec, roomID, name, pos, seq, notePointID)
}

// CopySectionAsRoom ajoute en dernière position une pièce copiée de la section sectionID
// du modèle courant ; ErrNotFound si la section n'existe pas. notePointID : voir InsertRoom.
func (t *Tx) CopySectionAsRoom(code, roomID, name, sectionID string, seq int64, notePointID string) error {
	tpl, err := readTemplate(t.ctx, t.tx)
	if err != nil {
		return err
	}
	for _, sec := range tpl.Sections {
		if sec.ID != sectionID {
			continue
		}
		pos, err := t.nextRoomPosition(code)
		if err != nil {
			return err
		}
		return copySection(t.tx, code, sec, roomID, name, pos, seq, notePointID)
	}
	return ErrNotFound
}

// RenameRoom change le nom de la pièce ; son dir_name ne change pas.
func (t *Tx) RenameRoom(id, name string, seq int64) error {
	_, err := t.tx.ExecContext(t.ctx, `UPDATE visit_rooms SET name = ?, seq = ? WHERE id = ?`, name, seq, id)
	return err
}

// HideRoom masque la pièce.
func (t *Tx) HideRoom(id string, seq int64) error {
	_, err := t.tx.ExecContext(t.ctx, `UPDATE visit_rooms SET hidden = 1, seq = ? WHERE id = ?`, seq, id)
	return err
}

// InsertPoint ajoute le point après le dernier de sa pièce ; p.Position est ignoré.
func (t *Tx) InsertPoint(p model.Point, seq int64) error {
	opts := p.Options
	if opts == nil {
		opts = []string{}
	}
	ob, err := json.Marshal(opts)
	if err != nil {
		return err
	}
	_, err = t.tx.ExecContext(t.ctx,
		`INSERT INTO visit_points (id, room_id, label, type, options, weight, position, seq)
		 SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM visit_points WHERE room_id = ?`,
		p.ID, p.RoomID, p.Label, string(p.Type), string(ob), p.Weight, seq, p.RoomID)
	return err
}

// InsertQuestion ajoute la question après la dernière de sa pièce ; q.Position est ignoré.
func (t *Tx) InsertQuestion(q model.Question, seq int64) error {
	_, err := t.tx.ExecContext(t.ctx,
		`INSERT INTO visit_questions (id, room_id, text, position, seq)
		 SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM visit_questions WHERE room_id = ?`,
		q.ID, q.RoomID, q.Text, seq, q.RoomID)
	return err
}

// CloseVisit clôture la visite à la date at.
func (t *Tx) CloseVisit(code string, at time.Time, seq int64) error {
	_, err := t.tx.ExecContext(t.ctx,
		`UPDATE visits SET closed_at = ?, seq_changed = ? WHERE code = ?`,
		at.UTC().Format(time.RFC3339), seq, code)
	return err
}

// LWWKind désigne une valeur soumise à la règle « dernière écriture gagnante ».
type LWWKind int

const (
	KindRating  LWWKind = iota // clé (point_id, device_id)
	KindComment                // clé (room_id, device_id)
	KindShared                 // clé (target_id, field)
	KindFiche                  // clé (code de la visite, champ de la fiche)
)

// LWWKey identifie une valeur : ID est le point, la pièce, la cible ou la visite,
// Sub l'appareil (notes, commentaires) ou le champ (valeurs partagées, fiche).
type LWWKey struct {
	ID, Sub string
}

// GetLWW renvoie l'horodatage et l'appareil de la valeur stockée ; ok est faux si
// la valeur n'a jamais été écrite par une opération.
func (t *Tx) GetLWW(kind LWWKind, key LWWKey) (ts int64, device string, ok bool, err error) {
	var row *sql.Row
	switch kind {
	case KindRating:
		row = t.tx.QueryRowContext(t.ctx,
			`SELECT updated_at, device_id FROM ratings WHERE point_id = ? AND device_id = ?`, key.ID, key.Sub)
	case KindComment:
		row = t.tx.QueryRowContext(t.ctx,
			`SELECT updated_at, device_id FROM room_comments WHERE room_id = ? AND device_id = ?`, key.ID, key.Sub)
	case KindShared:
		row = t.tx.QueryRowContext(t.ctx,
			`SELECT updated_at, device_id FROM shared_values WHERE target_id = ? AND field = ?`, key.ID, key.Sub)
	case KindFiche:
		if !isFicheColumn(key.Sub) {
			return 0, "", false, fmt.Errorf("champ de fiche inconnu %q", key.Sub)
		}
		// fiche_ts : {champ: [updated_at, device_id]}.
		var nts sql.NullInt64
		var ndev sql.NullString
		err = t.tx.QueryRowContext(t.ctx,
			`SELECT json_extract(fiche_ts, '$.' || ? || '[0]'), json_extract(fiche_ts, '$.' || ? || '[1]')
			 FROM visits WHERE code = ?`, key.Sub, key.Sub, key.ID).Scan(&nts, &ndev)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", false, ErrNotFound
		}
		if err != nil || !nts.Valid {
			return 0, "", false, err
		}
		return nts.Int64, ndev.String, true, nil
	default:
		return 0, "", false, fmt.Errorf("type de valeur inconnu %d", kind)
	}
	err = row.Scan(&ts, &device)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}
	return ts, device, true, nil
}

// PutLWW écrit la valeur (JSON déjà validé) avec son horodatage, son appareil et seq.
// Pour la fiche, met aussi à jour fiche_ts et seq_changed.
func (t *Tx) PutLWW(kind LWWKind, key LWWKey, value json.RawMessage, ts int64, device string, seq int64) error {
	switch kind {
	case KindRating:
		var v *int
		if err := json.Unmarshal(value, &v); err != nil {
			return fmt.Errorf("note: %w", err)
		}
		_, err := t.tx.ExecContext(t.ctx,
			`INSERT INTO ratings (point_id, device_id, value, updated_at, seq) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (point_id, device_id) DO UPDATE
			 SET value = excluded.value, updated_at = excluded.updated_at, seq = excluded.seq`,
			key.ID, key.Sub, v, ts, seq)
		return err
	case KindComment:
		var text string
		if err := json.Unmarshal(value, &text); err != nil {
			return fmt.Errorf("commentaire: %w", err)
		}
		_, err := t.tx.ExecContext(t.ctx,
			`INSERT INTO room_comments (room_id, device_id, text, updated_at, seq) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (room_id, device_id) DO UPDATE
			 SET text = excluded.text, updated_at = excluded.updated_at, seq = excluded.seq`,
			key.ID, key.Sub, text, ts, seq)
		return err
	case KindShared:
		var compact bytes.Buffer
		if err := json.Compact(&compact, value); err != nil {
			return fmt.Errorf("valeur partagée: %w", err)
		}
		_, err := t.tx.ExecContext(t.ctx,
			`INSERT INTO shared_values (target_id, field, value, updated_at, device_id, seq) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (target_id, field) DO UPDATE
			 SET value = excluded.value, updated_at = excluded.updated_at, device_id = excluded.device_id, seq = excluded.seq`,
			key.ID, key.Sub, compact.String(), ts, device, seq)
		return err
	case KindFiche:
		if !isFicheColumn(key.Sub) {
			return fmt.Errorf("champ de fiche inconnu %q", key.Sub)
		}
		var v any
		if err := json.Unmarshal(value, &v); err != nil {
			return fmt.Errorf("fiche %s: %w", key.Sub, err)
		}
		// key.Sub est une colonne de ficheColumns : l'insérer dans la requête est sûr.
		_, err := t.tx.ExecContext(t.ctx,
			`UPDATE visits SET `+key.Sub+` = ?,
			 fiche_ts = json_set(fiche_ts, '$.' || ?, json_array(?, ?)), seq_changed = ?
			 WHERE code = ?`,
			v, key.Sub, ts, device, seq, key.ID)
		return err
	}
	return fmt.Errorf("type de valeur inconnu %d", kind)
}

// TouchLWW donne le seq à la valeur stockée sans la modifier : une écriture perdante la
// fait ainsi renvoyer par /changes, pour que son expéditeur reprenne la valeur gagnante.
// Pour la fiche, seul seq_changed avance.
func (t *Tx) TouchLWW(kind LWWKind, key LWWKey, seq int64) error {
	var query string
	switch kind {
	case KindRating:
		query = `UPDATE ratings SET seq = ? WHERE point_id = ? AND device_id = ?`
	case KindComment:
		query = `UPDATE room_comments SET seq = ? WHERE room_id = ? AND device_id = ?`
	case KindShared:
		query = `UPDATE shared_values SET seq = ? WHERE target_id = ? AND field = ?`
	case KindFiche:
		_, err := t.tx.ExecContext(t.ctx, `UPDATE visits SET seq_changed = ? WHERE code = ?`, seq, key.ID)
		return err
	default:
		return fmt.Errorf("type de valeur inconnu %d", kind)
	}
	_, err := t.tx.ExecContext(t.ctx, query, seq, key.ID, key.Sub)
	return err
}
