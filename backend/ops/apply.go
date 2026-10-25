package ops

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/store"
)

// ApplyBatch applique le lot opération par opération, une transaction chacune : une
// opération refusée n'empêche pas les suivantes. Renvoie un résultat par opération et
// le seq courant de la visite. Une erreur (base, visite inconnue) interrompt le lot.
func ApplyBatch(ctx context.Context, s *store.Store, code, device string, batch []Op, now time.Time) ([]Result, int64, error) {
	results := make([]Result, 0, len(batch))
	for _, op := range batch {
		r, err := applyOne(ctx, s, code, device, op, now)
		if err != nil {
			return results, 0, err
		}
		results = append(results, r)
	}
	var seq int64
	err := s.InTx(ctx, func(tx *store.Tx) error {
		v, err := tx.Visit(code)
		seq = v.Seq
		return err
	})
	if err != nil {
		return results, 0, err
	}
	return results, seq, nil
}

// applyOne suit les règles 1 à 4 de la spec (§7.1). Une opération refusée est annulée
// puis journalisée dans sa propre transaction, pour qu'un nouvel envoi soit un doublon.
func applyOne(ctx context.Context, s *store.Store, code, device string, op Op, now time.Time) (Result, error) {
	res := Result{OpID: op.OpID}
	if op.OpID == "" {
		// Sans op_id, l'opération ne peut pas être journalisée.
		res.Result, res.Reason = ResultRejected, ReasonInvalid
		return res, nil
	}
	rec := store.OpRecord{
		OpID: op.OpID, VisitCode: code, DeviceID: device, Type: op.Type,
		Payload: op.Payload, ClientTS: op.ClientTS, ReceivedAt: now,
	}

	duplicate := false
	err := s.InTx(ctx, func(tx *store.Tx) error {
		seen, err := tx.OpSeen(op.OpID)
		if err != nil {
			return err
		}
		if seen {
			duplicate = true
			return nil
		}
		a := &applier{tx: tx, code: code, device: device, op: op, now: now}
		if err := a.apply(); err != nil {
			return err
		}
		rec.Result = ResultApplied
		return recordOnce(tx, rec, &duplicate)
	})
	if duplicate {
		// Doublon vu au début, ou course perdue sur la clé primaire (transaction annulée).
		res.Result = ResultDuplicate
		return res, nil
	}

	var rej *rejection
	if !errors.As(err, &rej) {
		if err != nil {
			return res, err
		}
		res.Result = ResultApplied
		return res, nil
	}
	rec.Result = ResultRejected + ":" + rej.reason
	err = s.InTx(ctx, func(tx *store.Tx) error { return recordOnce(tx, rec, &duplicate) })
	switch {
	case duplicate:
		res.Result = ResultDuplicate
	case err != nil:
		return res, err
	default:
		res.Result, res.Reason = ResultRejected, rej.reason
	}
	return res, nil
}

// recordOnce journalise l'opération ; une violation de la clé primaire signale un doublon.
func recordOnce(tx *store.Tx, rec store.OpRecord, duplicate *bool) error {
	err := tx.RecordOp(rec)
	if errors.Is(err, store.ErrConflict) {
		*duplicate = true
	}
	return err
}

// applier applique une opération dans sa transaction.
type applier struct {
	tx     *store.Tx
	code   string
	device string
	op     Op
	now    time.Time
	visit  store.VisitRow
}

var handlers = map[string]func(*applier) error{
	TypeAddRoom:     (*applier).addRoom,
	TypeRenameRoom:  (*applier).renameRoom,
	TypeHideRoom:    (*applier).hideRoom,
	TypeAddPoint:    (*applier).addPoint,
	TypeAddQuestion: (*applier).addQuestion,
	TypeSetRating:   (*applier).setRating,
	TypeSetComment:  (*applier).setComment,
	TypeSetShared:   (*applier).setShared,
	TypeSetFiche:    (*applier).setFiche,
	TypeCloseVisit:  (*applier).closeVisit,
}

func (a *applier) apply() error {
	handler, ok := handlers[a.op.Type]
	if !ok {
		return reject(ReasonInvalid)
	}
	v, err := a.tx.Visit(a.code)
	if err != nil {
		return err
	}
	a.visit = v
	// Les droits d'abord : un participant reste « forbidden » même sur une visite clôturée.
	if (a.op.Type == TypeSetFiche || a.op.Type == TypeCloseVisit) && a.device != v.CreatorDevice {
		return reject(ReasonForbidden)
	}
	if v.Closed {
		return reject(ReasonClosed)
	}
	return handler(a)
}

// decode lit le payload ; illisible ⇒ invalid.
func (a *applier) decode(dst any) error {
	if err := json.Unmarshal(a.op.Payload, dst); err != nil {
		return reject(ReasonInvalid)
	}
	return nil
}

// inVisit traduit l'absence de la cible, ou son appartenance à une autre visite, en not_found.
func (a *applier) inVisit(code string, err error) error {
	if errors.Is(err, store.ErrNotFound) || (err == nil && code != a.code) {
		return reject(ReasonNotFound)
	}
	return err
}

func (a *applier) room(id string) (model.Room, error) {
	r, code, err := a.tx.Room(id)
	return r, a.inVisit(code, err)
}

// idTaken indique si id désigne déjà une pièce, un point ou une question (de toute visite) :
// les cibles des valeurs partagées sont résolues par id dans ces trois tables.
func (a *applier) idTaken(id string) (bool, error) {
	lookups := []func(string) error{
		func(id string) error { _, _, err := a.tx.Room(id); return err },
		func(id string) error { _, _, err := a.tx.Point(id); return err },
		func(id string) error { _, _, err := a.tx.Question(id); return err },
	}
	for _, lookup := range lookups {
		err := lookup(id)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return false, err
		}
	}
	return false, nil
}

// newID vérifie l'identifiant d'un élément ajouté : non vide et encore libre.
func (a *applier) newID(id string) error {
	if id == "" {
		return reject(ReasonInvalid)
	}
	taken, err := a.idTaken(id)
	if err != nil {
		return err
	}
	if taken {
		return reject(ReasonInvalid)
	}
	return nil
}

// writeLWW applique les règles 3 et 4 : la valeur n'est écrite (avec un nouveau seq)
// que si elle l'emporte sur la valeur stockée ; sinon l'opération est sans effet.
func (a *applier) writeLWW(kind store.LWWKind, key store.LWWKey, value json.RawMessage) error {
	ts, dev, ok, err := a.tx.GetLWW(kind, key)
	if err != nil {
		return err
	}
	if ok && !Wins(ts, dev, a.op.ClientTS, a.device) {
		return nil
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.PutLWW(kind, key, value, a.op.ClientTS, a.device, seq)
}

func (a *applier) addRoom() error {
	var p struct {
		ID            string  `json:"id"`
		Name          string  `json:"name"`
		FromSectionID *string `json:"from_section_id"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return reject(ReasonInvalid)
	}
	if err := a.newID(p.ID); err != nil {
		return err
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	if p.FromSectionID == nil || *p.FromSectionID == "" {
		return a.tx.InsertRoom(a.code, p.ID, name, seq)
	}
	err = a.tx.CopySectionAsRoom(a.code, p.ID, name, *p.FromSectionID, seq)
	if errors.Is(err, store.ErrNotFound) {
		return reject(ReasonNotFound)
	}
	return err
}

func (a *applier) renameRoom() error {
	var p struct {
		RoomID string `json:"room_id"`
		Name   string `json:"name"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if _, err := a.room(p.RoomID); err != nil {
		return err
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		return reject(ReasonInvalid)
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.RenameRoom(p.RoomID, name, seq)
}

func (a *applier) hideRoom() error {
	var p struct {
		RoomID string `json:"room_id"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if _, err := a.room(p.RoomID); err != nil {
		return err
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.HideRoom(p.RoomID, seq)
}

func (a *applier) addPoint() error {
	var p struct {
		ID      string          `json:"id"`
		RoomID  string          `json:"room_id"`
		Label   string          `json:"label"`
		Type    model.PointType `json:"type"`
		Options []string        `json:"options"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if _, err := a.room(p.RoomID); err != nil {
		return err
	}
	label := strings.TrimSpace(p.Label)
	if label == "" {
		return reject(ReasonInvalid)
	}
	// Mêmes règles que pour un point du modèle : options exigées pour un constat, interdites sinon.
	switch p.Type {
	case model.TypeConstat:
		if len(p.Options) == 0 {
			return reject(ReasonInvalid)
		}
	case model.TypeNote, model.TypeCase:
		if len(p.Options) > 0 {
			return reject(ReasonInvalid)
		}
	default:
		return reject(ReasonInvalid)
	}
	if err := a.newID(p.ID); err != nil {
		return err
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.InsertPoint(model.Point{
		ID: p.ID, RoomID: p.RoomID, Label: label, Type: p.Type, Options: p.Options, Weight: 1,
	}, seq)
}

func (a *applier) addQuestion() error {
	var p struct {
		ID     string `json:"id"`
		RoomID string `json:"room_id"`
		Text   string `json:"text"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if _, err := a.room(p.RoomID); err != nil {
		return err
	}
	text := strings.TrimSpace(p.Text)
	if text == "" {
		return reject(ReasonInvalid)
	}
	if err := a.newID(p.ID); err != nil {
		return err
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.InsertQuestion(model.Question{ID: p.ID, RoomID: p.RoomID, Text: text}, seq)
}

func (a *applier) setRating() error {
	var p struct {
		PointID string          `json:"point_id"`
		Value   json.RawMessage `json:"value"` // nil si absent, « null » pour N/A
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	pt, code, err := a.tx.Point(p.PointID)
	if err := a.inVisit(code, err); err != nil {
		return err
	}
	if pt.Type != model.TypeNote || p.Value == nil {
		return reject(ReasonInvalid)
	}
	var v *int
	if err := json.Unmarshal(p.Value, &v); err != nil || (v != nil && (*v < 1 || *v > 5)) {
		return reject(ReasonInvalid)
	}
	value, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return a.writeLWW(store.KindRating, store.LWWKey{ID: p.PointID, Sub: a.device}, value)
}

func (a *applier) setComment() error {
	var p struct {
		RoomID string  `json:"room_id"`
		Text   *string `json:"text"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if _, err := a.room(p.RoomID); err != nil {
		return err
	}
	if p.Text == nil {
		return reject(ReasonInvalid)
	}
	value, err := json.Marshal(*p.Text)
	if err != nil {
		return err
	}
	return a.writeLWW(store.KindComment, store.LWWKey{ID: p.RoomID, Sub: a.device}, value)
}

func (a *applier) setShared() error {
	var p struct {
		TargetID string          `json:"target_id"`
		Field    string          `json:"field"`
		Value    json.RawMessage `json:"value"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	kind, pt, err := a.sharedTarget(p.TargetID)
	if err != nil {
		return err
	}
	if p.Value == nil || model.ValidSharedValue(kind, pt, p.Field, p.Value) != nil {
		return reject(ReasonInvalid)
	}
	return a.writeLWW(store.KindShared, store.LWWKey{ID: p.TargetID, Sub: p.Field}, p.Value)
}

// sharedTarget résout la cible d'une valeur partagée : point, puis question, puis pièce.
// Le point n'est renvoyé que pour TargetPoint.
func (a *applier) sharedTarget(id string) (model.TargetKind, *model.Point, error) {
	pt, code, err := a.tx.Point(id)
	if err == nil {
		if code != a.code {
			return 0, nil, reject(ReasonNotFound)
		}
		return model.TargetPoint, &pt, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return 0, nil, err
	}
	_, code, err = a.tx.Question(id)
	if err == nil {
		return model.TargetQuestion, nil, a.inVisit(code, nil)
	}
	if !errors.Is(err, store.ErrNotFound) {
		return 0, nil, err
	}
	_, err = a.room(id)
	return model.TargetRoom, nil, err
}

// setFiche applique chaque champ présent selon sa propre « dernière écriture gagnante ».
// Changer bedrooms_count ne crée ni ne retire aucune pièce.
func (a *applier) setFiche() error {
	var p struct {
		Fields map[string]json.RawMessage `json:"fields"`
	}
	if err := a.decode(&p); err != nil {
		return err
	}
	if p.Fields == nil {
		return reject(ReasonInvalid)
	}
	merged, err := mergeFiche(a.visit.Fiche, p.Fields)
	if err != nil {
		return err
	}

	names := make([]string, 0, len(p.Fields))
	for name := range p.Fields {
		names = append(names, name)
	}
	slices.Sort(names)
	winners := []string{}
	for _, name := range names {
		ts, dev, ok, err := a.tx.GetLWW(store.KindFiche, store.LWWKey{ID: a.code, Sub: name})
		if err != nil {
			return err
		}
		if !ok || Wins(ts, dev, a.op.ClientTS, a.device) {
			winners = append(winners, name)
		}
	}
	if len(winners) == 0 {
		return nil
	}
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	for _, name := range winners {
		if err := a.tx.PutLWW(store.KindFiche, store.LWWKey{ID: a.code, Sub: name}, merged[name], a.op.ClientTS, a.device, seq); err != nil {
			return err
		}
	}
	return nil
}

// mergeFiche applique tous les champs reçus à la fiche courante et vérifie le résultat ;
// champ inconnu, valeur mal typée ou fiche invalide ⇒ invalid. Chaque champ étant validé
// indépendamment, la fiche obtenue avec les seuls champs gagnants est elle aussi valide.
// Renvoie les valeurs normalisées, champ par champ.
func mergeFiche(cur model.Fiche, fields map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	merged, err := ficheFields(cur)
	if err != nil {
		return nil, err
	}
	for name, raw := range fields {
		if _, ok := merged[name]; !ok {
			return nil, reject(ReasonInvalid)
		}
		merged[name] = raw
	}
	b, err := json.Marshal(merged)
	if err != nil {
		return nil, reject(ReasonInvalid)
	}
	var f model.Fiche
	if err := json.Unmarshal(b, &f); err != nil || f.Validate() != nil {
		return nil, reject(ReasonInvalid)
	}
	return ficheFields(f)
}

// ficheFields renvoie la fiche sous la forme {champ JSON: valeur}.
func ficheFields(f model.Fiche) (map[string]json.RawMessage, error) {
	b, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (a *applier) closeVisit() error {
	seq, err := a.tx.NextSeq(a.code)
	if err != nil {
		return err
	}
	return a.tx.CloseVisit(a.code, a.now, seq)
}
