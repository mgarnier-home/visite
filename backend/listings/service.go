// Package listings crée et met à jour les annonces suivies.
package listings

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mgarnier-home/utils/logger"
	"github.com/mgarnier-home/visite/model"
	"github.com/mgarnier-home/visite/photos"
	"github.com/mgarnier-home/visite/scrape"
	"github.com/mgarnier-home/visite/store"
)

var ErrNoLink = errors.New("aucun lien dans ce texte")

// ErrFetch enveloppe l'erreur d'origine de la récupération.
var ErrFetch = errors.New("le site n'a pas renvoyé l'annonce")

// DuplicateError : le lien est déjà suivi, sous l'annonce ID.
type DuplicateError struct{ ID string }

func (DuplicateError) Error() string { return "annonce déjà suivie" }

const maxPhoto = 15 << 20

var extensions = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
}

type Service struct {
	Store    *store.Store
	Photos   photos.Store
	Fetcher  scrape.Fetcher
	Download func(ctx context.Context, url string) (*http.Response, error) // scrape.Client.Get en production
	Now      func() time.Time
	Log      *logger.Logger // peut être nil
}

// Create cherche le lien dans le texte partagé, lit l'annonce (sauf source manuelle), l'enregistre
// puis télécharge ses photos. Une photo qui échoue est ignorée.
func (s *Service) Create(ctx context.Context, text string) (model.Listing, error) {
	source, url, ok := scrape.FindURL(text)
	if !ok {
		return model.Listing{}, ErrNoLink
	}
	if id, err := s.Store.ListingIDByURL(ctx, url); err == nil {
		return model.Listing{}, DuplicateError{ID: id}
	} else if !errors.Is(err, store.ErrNotFound) {
		return model.Listing{}, err
	}

	now := s.Now()
	l := model.Listing{Source: source, URL: url}
	var res scrape.Result
	if source == scrape.SourceManual {
		l.Title = strings.Join(strings.Fields(strings.Replace(text, url, "", 1)), " ")
	} else {
		var err error
		if res, err = s.Fetcher.Fetch(ctx, source, url); err != nil {
			return model.Listing{}, fmt.Errorf("%w: %w", ErrFetch, err)
		}
		l.ListingData = res.Data
		fetched := now.UTC().Format(time.RFC3339)
		l.FetchedAt = &fetched
	}
	l, err := s.Store.CreateListing(ctx, l, res.Raw, now)
	if errors.Is(err, store.ErrConflict) { // créée entre-temps par une autre requête
		if id, e := s.Store.ListingIDByURL(ctx, url); e == nil {
			return model.Listing{}, DuplicateError{ID: id}
		}
	}
	if err != nil {
		return model.Listing{}, err
	}

	for _, u := range res.PhotoURLs {
		if err := s.addPhoto(ctx, l.ID, u); err != nil && s.Log != nil {
			s.Log.Warnf("photo %s ignorée : %v", u, err)
		}
	}
	return s.Store.GetListing(ctx, l.ID)
}

// addPhoto télécharge l'image et l'enregistre ; elle refuse le non-https, le non-image et le > 15 Mo.
func (s *Service) addPhoto(ctx context.Context, listingID, url string) error {
	if !strings.HasPrefix(url, "https://") {
		return errors.New("lien non https")
	}
	resp, err := s.Download(ctx, url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	ctype, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if !strings.HasPrefix(ctype, "image/") {
		return fmt.Errorf("type %q n'est pas une image", ctype)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxPhoto+1))
	if err != nil {
		return err
	}
	if len(data) > maxPhoto {
		return errors.New("image de plus de 15 Mo")
	}
	ext, ok := extensions[ctype]
	if !ok {
		ext = ".img"
	}
	rel := "listings/" + listingID + "/" + uuid.NewString() + ext
	if err := s.Photos.Put(rel, bytes.NewReader(data)); err != nil {
		return err
	}
	if _, err := s.Store.AddListingPhoto(ctx, listingID, url, rel, int64(len(data))); err != nil {
		s.Photos.RemoveAll(rel)
		return err
	}
	return nil
}
