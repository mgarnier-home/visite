package api

import (
	"net/http"
	"regexp"
	"strings"
)

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// deviceID extrait l'identifiant d'appareil : en-tête X-Device-Id, sinon paramètre ?d=
// (pour les GET lancés par <img> et les téléchargements). Il doit être un UUID.
func deviceID(r *http.Request) (string, bool) {
	id := r.Header.Get("X-Device-Id")
	if id == "" {
		id = r.URL.Query().Get("d")
	}
	id = strings.ToLower(id)
	if !uuidRe.MatchString(id) {
		return "", false
	}
	return id, true
}
