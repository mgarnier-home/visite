package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/mgarnier-home/utils/config"
	"github.com/mgarnier-home/utils/logger"

	"github.com/mgarnier-home/visite/api"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/seed"
	"github.com/mgarnier-home/visite/store"
	"github.com/mgarnier-home/visite/web"
)

func main() {
	log := logger.InitAppLogger("visite")

	var cfg Config
	if errs := config.GetConfig(&cfg); len(errs) > 0 {
		for _, err := range errs {
			log.Errorf("configuration invalide : %v", err)
		}
		os.Exit(1)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Errorf("ouverture de la base : %v", err)
		os.Exit(1)
	}
	defer st.Close()

	tpl, err := seed.Template()
	if err != nil {
		log.Errorf("%v", err)
		os.Exit(1)
	}
	if err := st.SeedTemplateIfEmpty(context.Background(), tpl); err != nil {
		log.Errorf("installation du modèle initial : %v", err)
		os.Exit(1)
	}

	router := api.NewRouter(api.Deps{Log: log, Now: time.Now, Store: st, Photos: photos.FS{Root: cfg.PhotosDir}, Web: web.Handler()})

	addr := fmt.Sprintf(":%d", cfg.ServerPort)
	log.Infof("écoute sur %s", addr)

	if err := newServer(addr, router).ListenAndServe(); err != nil {
		log.Errorf("arrêt du serveur : %v", err)
		st.Close()
		os.Exit(1)
	}
}
