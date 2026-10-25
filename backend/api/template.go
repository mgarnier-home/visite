package api

import (
	"errors"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/store"
)

// registerTemplateRoutes ajoute les routes du modèle au sous-routeur /api.
func (h *handlers) registerTemplateRoutes(api *mux.Router) {
	api.HandleFunc("/template", h.getTemplate).Methods(http.MethodGet)
	api.HandleFunc("/template", h.putTemplate).Methods(http.MethodPut)
}

func (h *handlers) getTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireDevice(w, r); !ok {
		return
	}
	tpl, err := h.store.GetTemplate(r.Context())
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tpl)
}

func (h *handlers) putTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireDevice(w, r); !ok {
		return
	}
	var tpl model.Template
	if !decodeBody(w, r, &tpl) {
		return
	}
	saved, err := h.store.SaveTemplate(r.Context(), tpl)
	switch {
	case errors.Is(err, store.ErrVersionConflict):
		writeError(w, http.StatusConflict, "le modèle a été modifié entre-temps")
		return
	case errors.Is(err, model.ErrInvalid):
		writeError(w, http.StatusBadRequest, "modèle invalide")
		return
	case err != nil:
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}
