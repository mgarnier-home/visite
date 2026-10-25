// Package web embarque le frontend Angular compilé et le sert comme application monopage.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler sert le frontend embarqué (dossier dist).
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err) // impossible : le dossier dist est toujours embarqué
	}
	return handler(sub)
}

// noCacheFiles doivent toujours être revalidés (exigence du service worker Angular).
var noCacheFiles = map[string]bool{
	"index.html":     true,
	"ngsw.json":      true,
	"ngsw-worker.js": true,
}

// handler sert un fichier existant tel quel, 404 pour un fichier absent (dernier segment
// avec extension), et index.html pour toute autre route.
func handler(fsys fs.FS) http.Handler {
	files := http.FileServer(http.FS(fsys))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")

		if name != "" && name != "index.html" {
			if info, err := fs.Stat(fsys, name); err == nil && !info.IsDir() {
				if noCacheFiles[name] {
					w.Header().Set("Cache-Control", "no-cache")
				}
				files.ServeHTTP(w, r)
				return
			}
			// Un fichier absent (ancien chunk, ressource inconnue) n'est pas une route de
			// l'application : 404 plutôt qu'index.html servi sous un mauvais type.
			if path.Ext(name) != "" {
				w.Header().Set("Cache-Control", "no-cache")
				http.NotFound(w, r)
				return
			}
		}

		index, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.Error(w, "frontend non construit", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(index)
	})
}
