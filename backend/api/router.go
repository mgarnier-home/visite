// Package api expose le routeur HTTP de l'application.
package api

import (
	"time"

	"github.com/gorilla/mux"
	utilshttp "github.com/mgarnier-home/utils/http"
	"github.com/mgarnier-home/utils/logger"
	"github.com/mgarnier-home/utils/version"

	"github.com/mgarnier-home/visite/store"
)

// Deps regroupe les dépendances injectées dans le routeur.
type Deps struct {
	Log   *logger.Logger
	Now   func() time.Time
	Store *store.Store
}

// handlers porte les dépendances partagées par les gestionnaires de l'API.
type handlers struct {
	log   *logger.Logger
	now   func() time.Time
	store *store.Store
}

// NewRouter construit le routeur : route /version et sous-routeur /api.
func NewRouter(d Deps) *mux.Router {
	router := mux.NewRouter()

	if d.Log != nil {
		router.Use(utilshttp.LogRequestMiddleware(d.Log))
	}

	version.SetupVersionRoute(router)

	now := d.Now
	if now == nil {
		now = time.Now
	}
	h := &handlers{log: d.Log, now: now, store: d.Store}

	api := router.PathPrefix("/api").Subrouter()
	// Une route /api inconnue répond en JSON, pour que le repli SPA ne la capte jamais.
	api.NotFoundHandler = notFoundOrMethodNotAllowed(api)
	h.registerVisitRoutes(api)

	return router
}
