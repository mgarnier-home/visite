package api

import (
	"errors"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/mgarnier-home/visite/export"
	"github.com/mgarnier-home/visite/store"
)

// registerExportRoutes ajoute la route d'export au sous-routeur /api.
func (h *handlers) registerExportRoutes(api *mux.Router) {
	api.HandleFunc("/visits/{code}/export.csv", h.exportCSV).Methods(http.MethodGet)
}

func (h *handlers) exportCSV(w http.ResponseWriter, r *http.Request) {
	code, _, ok := h.requireParticipant(w, r)
	if !ok {
		return
	}
	d, err := h.store.ExportData(r.Context(), code)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "visite introuvable")
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	d.Year = h.now().Year()
	rows := export.Rows(d)

	sep, bom, contentType, ext := ';', true, "text/csv; charset=utf-8", ".csv"
	if r.URL.Query().Get("sep") == "tab" {
		sep, bom, contentType, ext = '\t', false, "text/tab-separated-values; charset=utf-8", ".tsv"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+code+ext+`"`)
	if err := export.Write(w, rows, sep, bom); err != nil && h.log != nil {
		h.log.Errorf("écriture de l'export : %v", err)
	}
}
