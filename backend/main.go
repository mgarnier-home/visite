package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/mgarnier-home/utils/config"
	"github.com/mgarnier-home/utils/logger"

	"github.com/mgarnier-home/visite/api"
)

func main() {
	log := logger.InitAppLogger("visite")

	var cfg Config
	if errs := config.GetConfig(&cfg); len(errs) > 0 {
		for _, err := range errs {
			log.Errorf("configuration invalide : %v", err)
		}
		panic("configuration invalide")
	}

	router := api.NewRouter(api.Deps{Log: log, Now: time.Now})

	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	log.Infof("écoute sur %s", addr)

	if err := http.ListenAndServe(addr, router); err != nil {
		log.Errorf("arrêt du serveur : %v", err)
	}
}
