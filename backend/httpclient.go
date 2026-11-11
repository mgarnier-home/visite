package main

import (
	"errors"
	"net/http"
	"time"
)

// newHTTPClient : client des appels sortants (sites d'annonces, photos). Il refuse toute
// redirection hors https, pour que la règle « photos en https » ne soit pas contournée.
func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" {
				return errors.New("redirection hors https refusée")
			}
			if len(via) >= 10 {
				return errors.New("trop de redirections")
			}
			return nil
		},
	}
}
