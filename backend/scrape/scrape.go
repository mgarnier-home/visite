package scrape

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/mgarnier-home/visite/model"
)

// Result est le contenu lu sur le site d'une annonce.
type Result struct {
	Data      model.ListingData
	PhotoURLs []string
	Raw       json.RawMessage
}

var (
	ErrRemoved = errors.New("annonce retirée du site")
	ErrFormat  = errors.New("format de l'annonce non reconnu")
)

const maxBody = 10 << 20

// Fetcher lit une annonce à partir de son lien nettoyé.
type Fetcher interface {
	Fetch(ctx context.Context, source, url string) (Result, error)
}

// Client lit les annonces. Des bases vides désignent les sites réels.
type Client struct {
	HTTP                              *http.Client // nil : délai de 20 s
	UserAgent, BieniciBase, JinkaBase string
}

var defaultHTTP = &http.Client{Timeout: 20 * time.Second}

// Fetch lit l'annonce selon sa source (bienici ou jinka).
func (c *Client) Fetch(ctx context.Context, source, url string) (Result, error) {
	switch source {
	case SourceBienici:
		return c.fetchBienici(ctx, url)
	case SourceJinka:
		return c.fetchJinka(ctx, url)
	}
	return Result{}, fmt.Errorf("source %q non récupérable", source)
}

// Get envoie un GET avec le User-Agent du client. 404 et 410 donnent ErrRemoved,
// tout autre statut hors 2xx une erreur. Le corps de la réponse reste à fermer.
func (c *Client) Get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	h := c.HTTP
	if h == nil {
		h = defaultHTTP
	}
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		resp.Body.Close()
		return nil, ErrRemoved
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		resp.Body.Close()
		return nil, fmt.Errorf("réponse HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

// getBody lit au plus 10 Mo de la réponse.
func (c *Client) getBody(ctx context.Context, url string) ([]byte, error) {
	resp, err := c.Get(ctx, url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, maxBody))
}

func orBase(base, def string) string {
	if base == "" {
		return def
	}
	return base
}
