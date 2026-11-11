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
	"regexp"
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

// rawLinkRe : même motif que scrape.FindURL, pour retirer le lien tel que collé (avec requête et fragment).
var rawLinkRe = regexp.MustCompile(`https://\S+`)

const maxPhoto = 15 << 20

// maxManualTitle borne le titre d'une annonce manuelle (en runes).
const maxManualTitle = 200

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
		l.Title = strings.Join(strings.Fields(rawLinkRe.ReplaceAllString(text, "")), " ")
		if r := []rune(l.Title); len(r) > maxManualTitle {
			l.Title = string(r[:maxManualTitle])
		}
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

	s.addPhotos(ctx, l.ID, res.PhotoURLs, nil)
	return s.Store.GetListing(ctx, l.ID)
}

// addPhotos télécharge les photos absentes de known ; une photo qui échoue est ignorée et journalisée.
func (s *Service) addPhotos(ctx context.Context, listingID string, urls []string, known map[string]bool) {
	for _, u := range urls {
		if known[u] {
			continue
		}
		if err := s.addPhoto(ctx, listingID, u); err != nil && s.Log != nil {
			s.Log.Warnf("photo %s ignorée : %v", u, err)
		}
	}
}

// ErrManual : une annonce saisie à la main n'a pas de site à relire.
var ErrManual = errors.New("annonce saisie à la main : rien à rafraîchir")

// Failure : une annonce dont la relecture a échoué.
type Failure struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

// Report résume « Tout rafraîchir ».
type Report struct {
	Updated int       `json:"updated"`
	Removed int       `json:"removed"`
	Failed  []Failure `json:"failed"`
}

// Refresh relit l'annonce : caractéristiques et raw remplacées, nouvelles photos ajoutées, suivi
// intact. Annonce retirée du site (scrape.ErrRemoved) : removed_at renseigné, annonce renvoyée sans
// erreur. Autre échec : fetch_error renseigné, données gardées, erreur ErrFetch.
func (s *Service) Refresh(ctx context.Context, id string) (model.Listing, error) {
	cur, err := s.Store.GetListing(ctx, id)
	if err != nil {
		return model.Listing{}, err
	}
	if cur.Source == scrape.SourceManual {
		return model.Listing{}, ErrManual
	}
	now := s.Now()
	res, err := s.Fetcher.Fetch(ctx, cur.Source, cur.URL)
	if errors.Is(err, scrape.ErrRemoved) {
		if err := s.Store.SetFetchFailure(ctx, id, true, "", now); err != nil {
			return model.Listing{}, err
		}
		return s.Store.GetListing(ctx, id)
	}
	if err != nil {
		if ctx.Err() != nil { // annulation : pas un échec du site, rien à enregistrer
			return model.Listing{}, ctx.Err()
		}
		if e := s.Store.SetFetchFailure(ctx, id, false, err.Error(), now); e != nil {
			return model.Listing{}, e
		}
		return model.Listing{}, fmt.Errorf("%w: %w", ErrFetch, err)
	}
	if err := s.Store.ApplyFetch(ctx, id, res.Data, res.Raw, now); err != nil {
		return model.Listing{}, err
	}
	known, err := s.Store.ListingPhotoURLs(ctx, id)
	if err != nil {
		return model.Listing{}, err
	}
	s.addPhotos(ctx, id, res.PhotoURLs, known)
	return s.Store.GetListing(ctx, id)
}

// RefreshAll relit une à une les annonces non écartées et non manuelles, avec pause entre deux.
func (s *Service) RefreshAll(ctx context.Context, pause time.Duration) (Report, error) {
	ids, err := s.Store.RefreshCandidates(ctx)
	if err != nil {
		return Report{}, err
	}
	rep := Report{Failed: []Failure{}}
	for i, id := range ids {
		if i > 0 {
			select {
			case <-time.After(pause):
			case <-ctx.Done():
				return rep, ctx.Err()
			}
		}
		l, err := s.Refresh(ctx, id)
		switch {
		case err != nil && ctx.Err() != nil:
			return rep, ctx.Err() // rapport partiel : les annonces déjà traitées
		case errors.Is(err, store.ErrNotFound): // supprimée entre-temps
		case err != nil:
			rep.Failed = append(rep.Failed, Failure{ID: id, Error: err.Error()})
		case l.RemovedAt != nil:
			rep.Removed++
		default:
			rep.Updated++
		}
	}
	return rep, nil
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
