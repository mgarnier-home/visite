package photos_test

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mgarnier-home/visite/photos"
)

const photoID = "e5f6a7b8-1234-4abc-8def-0123456789ab"

func TestPhotoPath(t *testing.T) {
	at, err := time.Parse(time.RFC3339, "2026-10-25T14:35:20+02:00")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := photos.PhotoPath("maison-nantes-centre", "cuisine", at, photoID),
		"maison-nantes-centre/cuisine/20261025-143520-e5f6a7b8.jpg"; got != want {
		t.Errorf("avec pièce = %q, veut %q", got, want)
	}
	if got, want := photos.PhotoPath("maison-nantes-centre", "", at, photoID),
		"maison-nantes-centre/20261025-143520-e5f6a7b8.jpg"; got != want {
		t.Errorf("globale = %q, veut %q", got, want)
	}
}

func TestFSPutCreatesTree(t *testing.T) {
	fs := photos.FS{Root: t.TempDir()}
	rel := "maison/cuisine/a.jpg"
	if err := fs.Put(rel, bytes.NewReader([]byte("données"))); err != nil {
		t.Fatalf("Put: %v", err)
	}
	rc, err := fs.Open(rel)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	if string(b) != "données" {
		t.Errorf("contenu = %q", b)
	}
	entries, _ := os.ReadDir(filepath.Join(fs.Root, "maison", "cuisine"))
	if len(entries) != 1 {
		t.Errorf("fichier temporaire laissé : %v", entries)
	}
}

func TestFSRejectsEscapingPath(t *testing.T) {
	root := t.TempDir()
	fs := photos.FS{Root: filepath.Join(root, "photos")}
	for _, rel := range []string{"../x.jpg", "a/../../x.jpg", "/etc/x.jpg", ""} {
		if err := fs.Put(rel, bytes.NewReader([]byte("x"))); err == nil {
			t.Errorf("Put(%q) devrait échouer", rel)
		}
		if _, err := fs.Open(rel); err == nil {
			t.Errorf("Open(%q) devrait échouer", rel)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "x.jpg")); err == nil {
		t.Error("fichier écrit hors de la racine")
	}
}

func TestCheckJPEG(t *testing.T) {
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	r, err := photos.CheckJPEG(bytes.NewReader(jpeg))
	if err != nil {
		t.Fatalf("JPEG refusé : %v", err)
	}
	if b, _ := io.ReadAll(r); !bytes.Equal(b, jpeg) {
		t.Errorf("flux altéré : %x", b)
	}
	png := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if _, err := photos.CheckJPEG(bytes.NewReader(png)); !errors.Is(err, photos.ErrNotJPEG) {
		t.Errorf("PNG : %v", err)
	}
	if _, err := photos.CheckJPEG(bytes.NewReader([]byte{0xFF})); !errors.Is(err, photos.ErrNotJPEG) {
		t.Errorf("flux trop court : %v", err)
	}
}
