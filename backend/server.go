package main

import (
	"net/http"
	"time"
)

// newServer construit le serveur HTTP avec des délais bornés : un client lent ou muet ne
// garde pas indéfiniment une connexion. 60 s suffisent pour envoyer une photo de 10 Mo.
func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}
