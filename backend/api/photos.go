package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/store"
)

const (
	// maxPhotoBytes est la taille maximale du fichier d'une photo (10 Mo).
	maxPhotoBytes = 10 << 20
	// maxPhotoBodyBytes borne le corps multipart entier (photo + champs).
	maxPhotoBodyBytes = 11 << 20
)

// registerPhotoRoutes ajoute les routes des photos au sous-routeur /api.
func (h *handlers) registerPhotoRoutes(api *mux.Router) {
	api.HandleFunc("/visits/{code}/photos", h.uploadPhoto).Methods(http.MethodPost)
	api.HandleFunc("/visits/{code}/photos/{id}", h.getPhoto).Methods(http.MethodGet)
}

func (h *handlers) uploadPhoto(w http.ResponseWriter, r *http.Request) {
	code, device, ok := h.requireParticipant(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBodyBytes)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "photo trop volumineuse (10 Mo au maximum)")
		} else {
			writeError(w, http.StatusBadRequest, "formulaire multipart invalide")
		}
		return
	}
	defer r.MultipartForm.RemoveAll()

	id := strings.ToLower(r.FormValue("id"))
	if !uuidRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "id de photo invalide")
		return
	}
	takenAt, err := time.Parse(time.RFC3339, r.FormValue("taken_at"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "taken_at invalide (RFC 3339 attendu)")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "fichier manquant")
		return
	}
	defer file.Close()
	if header.Size > maxPhotoBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "photo trop volumineuse (10 Mo au maximum)")
		return
	}

	var roomID *string
	dirName := ""
	if rid := r.FormValue("room_id"); rid != "" {
		dirName, err = h.store.RoomDirName(r.Context(), code, rid)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "pièce introuvable")
			return
		}
		if err != nil {
			h.internalError(w, err)
			return
		}
		roomID = &rid
	}

	content, err := photos.CheckJPEG(file)
	if errors.Is(err, photos.ErrNotJPEG) {
		writeError(w, http.StatusUnsupportedMediaType, "seuls les JPEG sont acceptés")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}

	// Visite clôturée ou id déjà pris : refusé avant d'écrire quoi que ce soit sur le disque.
	exists, err := h.store.CheckPhotoUpload(r.Context(), code, id)
	if h.photoRefused(w, err) {
		return
	}
	// Le fichier est écrit avant l'enregistrement : s'il échoue, le fichier reste,
	// inoffensif, et sera réécrit à l'envoi suivant. Un renvoi d'une photo déjà
	// enregistrée ne réécrit rien.
	rel := photos.PhotoPath(code, dirName, takenAt, id)
	if !exists {
		if err := h.photos.Put(rel, content); err != nil {
			h.internalError(w, err)
			return
		}
	}
	created, err := h.store.AddPhoto(r.Context(), store.PhotoRecord{
		ID: id, VisitCode: code, RoomID: roomID, DeviceID: device,
		TakenAt: takenAt, Path: rel, Size: header.Size,
	})
	if h.photoRefused(w, err) {
		return
	}
	number, err := h.store.ParticipantNumber(r.Context(), code, device)
	if err != nil {
		h.internalError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, model.Photo{ID: id, RoomID: roomID, Author: number, TakenAt: takenAt.Format(time.RFC3339)})
}

// photoRefused répond à l'erreur d'enregistrement d'une photo ; faux si err est nil.
func (h *handlers) photoRefused(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrClosed):
		writeError(w, http.StatusConflict, "la visite est clôturée")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "cet id de photo est déjà utilisé")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "visite ou pièce introuvable")
	default:
		h.internalError(w, err)
	}
	return true
}

func (h *handlers) getPhoto(w http.ResponseWriter, r *http.Request) {
	code, _, ok := h.requireParticipant(w, r)
	if !ok {
		return
	}
	rel, err := h.store.PhotoPathByID(r.Context(), code, mux.Vars(r)["id"])
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "photo introuvable")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	f, err := h.photos.Open(rel)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "fichier de la photo introuvable")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Une photo ne change jamais pour un id donné ; privée car liée à l'appareil (?d=).
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	// Les en-têtes sont partis : une erreur de copie (client parti) est seulement journalisée.
	if _, err := io.Copy(w, f); err != nil && h.log != nil {
		h.log.Errorf("envoi de la photo %s : %v", rel, err)
	}
}
