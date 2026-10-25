// Package photos range les photos des visites sur le système de fichiers.
package photos

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotJPEG : le flux ne commence pas par la signature JPEG.
var ErrNotJPEG = errors.New("ce n'est pas un JPEG")

// ErrBadPath : chemin absolu, vide ou qui sort de la racine.
var ErrBadPath = errors.New("chemin de photo invalide")

// Store : stockage des fichiers photo, adressés par chemin relatif.
type Store interface {
	Put(rel string, r io.Reader) error
	Open(rel string) (io.ReadCloser, error)
}

// FS implémente Store sur le système de fichiers, sous Root.
type FS struct{ Root string }

// resolve vérifie le chemin relatif et renvoie le chemin absolu sous Root.
func (f FS) resolve(rel string) (string, error) {
	if rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") {
		return "", fmt.Errorf("%w: %q", ErrBadPath, rel)
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %q", ErrBadPath, rel)
	}
	return filepath.Join(f.Root, clean), nil
}

// Put écrit le fichier dans un temporaire du même dossier puis le renomme.
func (f FS) Put(rel string, r io.Reader) error {
	full, err := f.resolve(rel)
	if err != nil {
		return err
	}
	dir := filepath.Dir(full)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // sans effet après un renommage réussi
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), full)
}

// Open ouvre le fichier en lecture.
func (f FS) Open(rel string) (io.ReadCloser, error) {
	full, err := f.resolve(rel)
	if err != nil {
		return nil, err
	}
	return os.Open(full)
}

// PhotoPath construit le chemin relatif d'une photo ; dirName vide : photo globale.
// L'heure est formatée dans son propre fuseau (heure locale du téléphone).
func PhotoPath(visitCode, dirName string, takenAt time.Time, id string) string {
	short := strings.ReplaceAll(id, "-", "")
	if len(short) > 8 {
		short = short[:8]
	}
	name := takenAt.Format("20060102-150405") + "-" + short + ".jpg"
	if dirName == "" {
		return path.Join(visitCode, name)
	}
	return path.Join(visitCode, dirName, name)
}

// CheckJPEG vérifie la signature FF D8 FF ; le lecteur renvoyé restitue le flux complet.
func CheckJPEG(r io.Reader) (io.Reader, error) {
	br := bufio.NewReader(r)
	head, err := br.Peek(3)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if len(head) < 3 || head[0] != 0xFF || head[1] != 0xD8 || head[2] != 0xFF {
		return nil, ErrNotJPEG
	}
	return br, nil
}
