// Package scrape repère les liens d'annonces dans un texte partagé et lit les
// annonces Bien'ici et Jinka. Aucune dépendance à la base de données.
package scrape

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// Sources d'une annonce.
const (
	SourceBienici = "bienici"
	SourceJinka   = "jinka"
	SourceManual  = "manual"
)

var urlRe = regexp.MustCompile(`https://\S+`)

// FindURL repère le premier lien https d'un texte, le nettoie et en déduit la
// source. ok vaut false s'il n'y a aucun lien exploitable.
func FindURL(text string) (source, link string, ok bool) {
	raw := urlRe.FindString(text)
	if raw == "" {
		return "", "", false
	}
	link, err := CleanURL(strings.TrimRight(raw, ".,;:!?)]>\"'"))
	if err != nil {
		return "", "", false
	}
	u, _ := url.Parse(link)
	return sourceOf(u.Hostname()), link, true
}

// CleanURL exige un lien https et retire la requête et le fragment (suivi
// publicitaire des partages).
func CleanURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "https" || u.Hostname() == "" {
		return "", errors.New("lien https attendu")
	}
	u.RawQuery, u.Fragment, u.RawFragment = "", "", ""
	return u.String(), nil
}

func sourceOf(host string) string {
	host = strings.ToLower(host)
	for domain, source := range map[string]string{"bienici.com": SourceBienici, "jinka.fr": SourceJinka} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return source
		}
	}
	return SourceManual
}
