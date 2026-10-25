// Package api expose le routeur HTTP de l'application.
package api

import (
	"time"

	"github.com/gorilla/mux"
	utilshttp "github.com/mgarnier-home/utils/http"
	"github.com/mgarnier-home/utils/logger"
	"github.com/mgarnier-home/utils/version"
)

// Deps regroupe les dépendances injectées dans le routeur.
type Deps struct {
	Log *logger.Logger
	Now func() time.Time
}

// NewRouter construit le routeur : route /version et sous-routeur /api.
func NewRouter(d Deps) *mux.Router {
	router := mux.NewRouter()

	if d.Log != nil {
		router.Use(utilshttp.LogRequestMiddleware(d.Log))
	}

	version.SetupVersionRoute(router)

	// Les routes de l'API sont ajoutées par les tâches suivantes.
	router.PathPrefix("/api").Subrouter()

	return router
}
