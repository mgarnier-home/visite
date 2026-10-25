// Package ops applique les opérations envoyées par les appareils : idempotence par op_id,
// droits, validation, puis « dernière écriture gagnante » pour les valeurs.
package ops

import "encoding/json"

// Op est une opération telle qu'envoyée par le client.
type Op struct {
	OpID     string          `json:"op_id"`
	Type     string          `json:"type"`
	ClientTS int64           `json:"client_ts"`
	Payload  json.RawMessage `json:"payload"`
}

// Result est le résultat d'une opération ; Reason n'est renseigné que pour un refus.
type Result struct {
	OpID   string `json:"op_id"`
	Result string `json:"result"`
	Reason string `json:"reason,omitempty"`
}

// Types d'opération.
const (
	TypeAddRoom     = "add_room"
	TypeRenameRoom  = "rename_room"
	TypeHideRoom    = "hide_room"
	TypeAddPoint    = "add_point"
	TypeAddQuestion = "add_question"
	TypeSetRating   = "set_rating"
	TypeSetComment  = "set_comment"
	TypeSetShared   = "set_shared"
	TypeSetFiche    = "set_fiche"
	TypeCloseVisit  = "close_visit"
)

// Résultats et motifs de refus.
const (
	ResultApplied   = "applied"
	ResultDuplicate = "duplicate"
	ResultRejected  = "rejected"

	ReasonClosed    = "closed"
	ReasonForbidden = "forbidden"
	ReasonNotFound  = "not_found"
	ReasonInvalid   = "invalid"
)

// Wins indique si l'écriture (opTS, opDev) l'emporte sur la valeur stockée :
// horodatage plus récent, ou, à horodatage égal, plus grand device_id.
func Wins(storedTS int64, storedDev string, opTS int64, opDev string) bool {
	if opTS != storedTS {
		return opTS > storedTS
	}
	return opDev > storedDev
}

// rejection est renvoyée par l'application d'une opération refusée (règle 2) ;
// elle annule la transaction de l'opération.
type rejection struct{ reason string }

func (r *rejection) Error() string { return "opération refusée : " + r.reason }

func reject(reason string) error { return &rejection{reason: reason} }
