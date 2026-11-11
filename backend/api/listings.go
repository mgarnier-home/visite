package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/listings"
	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/store"
)

// photoTypes : Content-Type d'après l'extension du fichier stocké (voir listings.extensions).
var photoTypes = map[string]string{
	".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
}

// registerListingRoutes ajoute les routes des annonces au sous-routeur /api.
func (h *handlers) registerListingRoutes(api *mux.Router) {
	api.HandleFunc("/listings", h.listListings).Methods(http.MethodGet)
	api.HandleFunc("/listings", h.createListing).Methods(http.MethodPost)
	api.HandleFunc("/listings/refresh", h.refreshAll).Methods(http.MethodPost)
	api.HandleFunc("/listings/{id}/refresh", h.refreshListing).Methods(http.MethodPost)
	api.HandleFunc("/listings/{id}", h.getListing).Methods(http.MethodGet)
	api.HandleFunc("/listings/{id}", h.patchListing).Methods(http.MethodPatch)
	api.HandleFunc("/listings/{id}", h.deleteListing).Methods(http.MethodDelete)
	api.HandleFunc("/listings/{id}/photos/{photoId}", h.listingPhoto).Methods(http.MethodGet)
}

func (h *handlers) listListings(w http.ResponseWriter, r *http.Request) {
	ls, err := h.store.ListListings(r.Context())
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ls)
}

func (h *handlers) createListing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	l, err := h.listings.Create(r.Context(), body.Text)
	var dup listings.DuplicateError
	switch {
	case errors.As(err, &dup):
		writeJSON(w, http.StatusConflict, map[string]string{"id": dup.ID, "error": "annonce déjà suivie"})
	case errors.Is(err, listings.ErrNoLink):
		writeError(w, http.StatusUnprocessableEntity, "aucun lien dans ce texte")
	case errors.Is(err, listings.ErrFetch):
		if h.log != nil {
			h.log.Warnf("récupération de l'annonce : %v", err)
		}
		writeError(w, http.StatusBadGateway, "le site n'a pas renvoyé l'annonce")
	case err != nil:
		h.internalError(w, err)
	default:
		writeJSON(w, http.StatusCreated, l)
	}
}

// listingErr répond à une erreur du store : 404, 400 (validation) ou 500.
func (h *handlers) listingErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "annonce introuvable")
	case errors.Is(err, model.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		h.internalError(w, err)
	}
}

func (h *handlers) getListing(w http.ResponseWriter, r *http.Request) {
	id, ok := requireCode(w, r)
	if !ok {
		return
	}
	l, err := h.store.GetListing(r.Context(), id)
	if err != nil {
		h.listingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, l)
}

func (h *handlers) patchListing(w http.ResponseWriter, r *http.Request) {
	id, ok := requireCode(w, r)
	if !ok {
		return
	}
	var fields map[string]json.RawMessage
	if !decodeBody(w, r, &fields) {
		return
	}
	l, err := h.store.UpdateListing(r.Context(), id, fields, h.now())
	if err != nil {
		h.listingErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, l)
}

func (h *handlers) deleteListing(w http.ResponseWriter, r *http.Request) {
	id, ok := requireCode(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteListing(r.Context(), id); err != nil {
		h.listingErr(w, err)
		return
	}
	for _, dir := range []string{id, "listings/" + id} {
		if err := h.photos.RemoveAll(dir); err != nil && h.log != nil {
			h.log.Errorf("suppression des fichiers %s : %v", dir, err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) listingPhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := requireCode(w, r)
	if !ok {
		return
	}
	photoID := strings.ToLower(mux.Vars(r)["photoId"])
	if !uuidRe.MatchString(photoID) {
		writeError(w, http.StatusBadRequest, "identifiant de photo invalide")
		return
	}
	rel, err := h.store.ListingPhotoPath(r.Context(), id, photoID)
	if err != nil {
		h.listingErr(w, err)
		return
	}
	f, err := h.photos.Open(rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "photo introuvable")
		return
	}
	defer f.Close()
	ctype := photoTypes[path.Ext(rel)]
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = io.Copy(w, f)
}

func (h *handlers) refreshListing(w http.ResponseWriter, r *http.Request) {
	id, ok := requireCode(w, r)
	if !ok {
		return
	}
	l, err := h.listings.Refresh(r.Context(), id)
	switch {
	case errors.Is(err, listings.ErrManual):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, listings.ErrFetch):
		if h.log != nil {
			h.log.Warnf("rafraîchissement de l'annonce : %v", err)
		}
		writeError(w, http.StatusBadGateway, "le site n'a pas renvoyé l'annonce")
	case err != nil:
		h.listingErr(w, err)
	default:
		writeJSON(w, http.StatusOK, l)
	}
}

func (h *handlers) refreshAll(w http.ResponseWriter, r *http.Request) {
	rep, err := h.listings.RefreshAll(r.Context(), time.Second)
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
