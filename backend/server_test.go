package main

import (
	"net/http"
	"testing"
	"time"
)

func TestNewServerTimeouts(t *testing.T) {
	h := http.NewServeMux()
	srv := newServer(":1234", h)
	if srv.Addr != ":1234" || srv.Handler != h {
		t.Fatalf("serveur = %+v", srv)
	}
	for name, c := range map[string]struct{ got, want time.Duration }{
		"ReadHeaderTimeout": {srv.ReadHeaderTimeout, 10 * time.Second},
		"ReadTimeout":       {srv.ReadTimeout, 60 * time.Second},
		"WriteTimeout":      {srv.WriteTimeout, 60 * time.Second},
		"IdleTimeout":       {srv.IdleTimeout, 120 * time.Second},
	} {
		if c.got != c.want {
			t.Errorf("%s = %v, attendu %v", name, c.got, c.want)
		}
	}
}
