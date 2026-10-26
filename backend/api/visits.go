package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/ops"
	"github.com/mgarnier-home/visite/store"
)

// maxOpsPerBatch est le nombre maximal d'opérations par lot.
const maxOpsPerBatch = 500

// registerVisitRoutes ajoute les routes des visites au sous-routeur /api.
func (h *handlers) registerVisitRoutes(api *mux.Router) {
	api.HandleFunc("/visits", h.createVisit).Methods(http.MethodPost)
	api.HandleFunc("/visits/{code}/exists", h.exists).Methods(http.MethodGet)
	api.HandleFunc("/visits/{code}/join", h.join).Methods(http.MethodPost)
	api.HandleFunc("/visits/{code}", h.state).Methods(http.MethodGet)
	api.HandleFunc("/visits/{code}/changes", h.changes).Methods(http.MethodGet)
	api.HandleFunc("/visits/{code}/ops", h.applyOps).Methods(http.MethodPost)
}

// internalError journalise l'erreur et répond 500 avec un message générique.
func (h *handlers) internalError(w http.ResponseWriter, err error) {
	if h.log != nil {
		h.log.Errorf("erreur interne : %v", err)
	}
	writeError(w, http.StatusInternalServerError, "erreur interne du serveur")
}

// requireDevice renvoie l'appareil de la requête, ou répond 400.
func requireDevice(w http.ResponseWriter, r *http.Request) (string, bool) {
	device, ok := deviceID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "identifiant d'appareil absent ou invalide")
	}
	return device, ok
}

// requireCode renvoie le code de visite de l'URL, ou répond 400.
func requireCode(w http.ResponseWriter, r *http.Request) (string, bool) {
	code := mux.Vars(r)["code"]
	if !model.ValidCode(code) {
		writeError(w, http.StatusBadRequest, "code de visite invalide")
		return "", false
	}
	return code, true
}

// requireParticipant vérifie code, appareil et participation : 400, 404 (visite
// inconnue) ou 403 (appareil non inscrit). Renvoie le code et l'appareil.
func (h *handlers) requireParticipant(w http.ResponseWriter, r *http.Request) (code, device string, ok bool) {
	code, ok = requireCode(w, r)
	if !ok {
		return "", "", false
	}
	device, ok = requireDevice(w, r)
	if !ok {
		return "", "", false
	}
	exists, err := h.store.VisitExists(r.Context(), code)
	if err != nil {
		h.internalError(w, err)
		return "", "", false
	}
	if !exists {
		writeError(w, http.StatusNotFound, "visite introuvable")
		return "", "", false
	}
	if _, err := h.store.ParticipantNumber(r.Context(), code, device); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusForbidden, "vous ne participez pas à cette visite")
		} else {
			h.internalError(w, err)
		}
		return "", "", false
	}
	return code, device, true
}

func (h *handlers) exists(w http.ResponseWriter, r *http.Request) {
	code, ok := requireCode(w, r)
	if !ok {
		return
	}
	exists, err := h.store.VisitExists(r.Context(), code)
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"exists": exists})
}

func (h *handlers) createVisit(w http.ResponseWriter, r *http.Request) {
	device, ok := requireDevice(w, r)
	if !ok {
		return
	}
	var req struct {
		Code               string      `json:"code"`
		Fiche              model.Fiche `json:"fiche"`
		ExcludedSectionIDs []string    `json:"excluded_section_ids"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if !model.ValidCode(req.Code) {
		writeError(w, http.StatusBadRequest, "code de visite invalide")
		return
	}
	err := h.store.CreateVisitExcluding(r.Context(), req.Code, req.Fiche, device, h.now(), req.ExcludedSectionIDs)
	switch {
	case errors.Is(err, store.ErrInvalidExcluded):
		writeError(w, http.StatusBadRequest, "sections exclues invalides")
		return
	case errors.Is(err, model.ErrInvalid):
		writeError(w, http.StatusBadRequest, "fiche invalide")
		return
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "ce code de visite existe déjà")
		return
	case err != nil:
		h.internalError(w, err)
		return
	}
	st, err := h.store.State(r.Context(), req.Code, device, 0)
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, st)
}

func (h *handlers) join(w http.ResponseWriter, r *http.Request) {
	code, ok := requireCode(w, r)
	if !ok {
		return
	}
	device, ok := requireDevice(w, r)
	if !ok {
		return
	}
	number, err := h.store.Join(r.Context(), code, device, h.now())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "visite introuvable")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"number": number})
}

func (h *handlers) state(w http.ResponseWriter, r *http.Request) {
	h.writeState(w, r, false)
}

func (h *handlers) changes(w http.ResponseWriter, r *http.Request) {
	h.writeState(w, r, true)
}

// writeState répond avec l'état de la visite ; avec withSince, seules les lignes
// postérieures à ?since= sont renvoyées.
func (h *handlers) writeState(w http.ResponseWriter, r *http.Request, withSince bool) {
	code, device, ok := h.requireParticipant(w, r)
	if !ok {
		return
	}
	var since int64
	if withSince {
		n, err := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "paramètre since invalide")
			return
		}
		since = n
	}
	st, err := h.store.State(r.Context(), code, device, since)
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *handlers) applyOps(w http.ResponseWriter, r *http.Request) {
	code, device, ok := h.requireParticipant(w, r)
	if !ok {
		return
	}
	var req struct {
		Ops []ops.Op `json:"ops"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if len(req.Ops) > maxOpsPerBatch {
		writeError(w, http.StatusRequestEntityTooLarge, "trop d'opérations dans le lot (500 au maximum)")
		return
	}
	for _, op := range req.Ops {
		if op.OpID == "" {
			writeError(w, http.StatusBadRequest, "op_id manquant dans le lot")
			return
		}
	}
	results, seq, err := ops.ApplyBatch(r.Context(), h.store, code, device, req.Ops, h.now())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "visite introuvable")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seq": seq, "results": results})
}
