package api

import (
	"encoding/json"
	"errors"
	"net/http"
)

// maxBodyBytes est la taille maximale d'un corps JSON (1 Mo).
const maxBodyBytes = 1 << 20

// writeJSON écrit une réponse JSON avec le code donné.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError écrit le corps d'erreur standard {"error": "..."}.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// decodeBody lit un corps JSON limité à 1 Mo. En cas d'échec la réponse d'erreur est
// déjà écrite (413 si le corps est trop gros, 400 sinon) et ok vaut false.
func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "corps de requête trop volumineux")
		} else {
			writeError(w, http.StatusBadRequest, "corps de requête invalide")
		}
		return false
	}
	return true
}

// notFoundHandler répond 404 JSON aux routes inconnues de l'API.
func notFoundHandler(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "route introuvable")
}
