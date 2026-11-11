package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPClientRefusesNonHTTPSRedirect(t *testing.T) {
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer plain.Close()
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, plain.URL+"/x", http.StatusFound)
	}))
	defer secure.Close()

	c := newHTTPClient()
	c.Transport = secure.Client().Transport
	if resp, err := c.Get(secure.URL); err == nil {
		resp.Body.Close()
		t.Fatal("la redirection vers http aurait dû être refusée")
	}
	if c.Timeout == 0 {
		t.Fatal("délai absent")
	}
}
