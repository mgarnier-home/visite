package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mgarnier-home/visite/model"
)

const testPhotoID = "e5f6a7b8-1234-4abc-8def-0123456789ab"

// jpegBytes renvoie un faux JPEG (signature valide) de la taille demandée.
func jpegBytes(size int) []byte {
	b := make([]byte, size)
	copy(b, []byte{0xFF, 0xD8, 0xFF, 0xE0})
	return b
}

type photoForm struct {
	id, roomID, takenAt string
	file                []byte
}

func uploadPhoto(t *testing.T, router http.Handler, code, device string, f photoForm) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("id", f.id)
	_ = mw.WriteField("room_id", f.roomID)
	_ = mw.WriteField("taken_at", f.takenAt)
	if f.file != nil {
		fw, _ := mw.CreateFormFile("file", "photo.jpg")
		_, _ = fw.Write(f.file)
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/visits/"+code+"/photos", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if device != "" {
		req.Header.Set("X-Device-Id", device)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func firstRoomID(t *testing.T, router http.Handler, code, device string) string {
	t.Helper()
	rec := do(t, router, "GET", "/api/visits/"+code, device, "")
	var st model.VisitState
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || len(st.Rooms) == 0 {
		t.Fatalf("état illisible : %v", err)
	}
	return st.Rooms[0].ID
}

func validForm(roomID string) photoForm {
	return photoForm{id: testPhotoID, roomID: roomID, takenAt: "2026-10-25T14:30:05+02:00", file: jpegBytes(2048)}
}

func TestPhotoUploadAndDownload(t *testing.T) {
	router, root := newTestRouterWithPhotos(t)
	createVisit(t, router, "maison-a", devA)
	room := firstRoomID(t, router, "maison-a", devA)
	form := validForm(room)

	rec := uploadPhoto(t, router, "maison-a", devA, form)
	wantCode(t, rec, http.StatusCreated)
	var p model.Photo
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.ID != testPhotoID || p.RoomID == nil || *p.RoomID != room || p.Author != 1 || p.TakenAt != "2026-10-25T14:30:05+02:00" {
		t.Fatalf("photo = %+v", p)
	}
	var found string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			found = path
		}
		return nil
	})
	if !strings.HasSuffix(found, "-e5f6a7b8.jpg") || !strings.Contains(found, "20261025-143005") {
		t.Fatalf("fichier = %q", found)
	}

	// Renvoi du même id : 200.
	wantCode(t, uploadPhoto(t, router, "maison-a", devA, form), http.StatusOK)

	// Relecture identique, via ?d=.
	get := do(t, router, "GET", "/api/visits/maison-a/photos/"+testPhotoID+"?d="+devA, "", "")
	wantCode(t, get, http.StatusOK)
	if ct := get.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if !bytes.Equal(get.Body.Bytes(), form.file) {
		t.Fatal("photo relue différente")
	}
}

func TestPhotoGlobalAndInState(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	form := validForm("")
	rec := uploadPhoto(t, router, "maison-a", devA, form)
	wantCode(t, rec, http.StatusCreated)
	if !strings.Contains(rec.Body.String(), `"room_id":null`) {
		t.Fatalf("corps = %s", rec.Body.String())
	}
	st := do(t, router, "GET", "/api/visits/maison-a", devA, "")
	if !strings.Contains(st.Body.String(), testPhotoID) {
		t.Fatal("photo absente de l'état")
	}
}

func TestPhotoUploadErrors(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	createVisit(t, router, "maison-b", devB)
	room := firstRoomID(t, router, "maison-a", devA)

	t.Run("appareil absent", func(t *testing.T) {
		wantCode(t, uploadPhoto(t, router, "maison-a", "", validForm(room)), 400)
	})
	t.Run("non participant", func(t *testing.T) {
		wantCode(t, uploadPhoto(t, router, "maison-a", devC, validForm(room)), 403)
	})
	t.Run("visite inconnue", func(t *testing.T) {
		wantCode(t, uploadPhoto(t, router, "inconnue-x", devA, validForm(room)), 404)
	})
	t.Run("id invalide", func(t *testing.T) {
		f := validForm(room)
		f.id = "pas-un-uuid"
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 400)
	})
	t.Run("taken_at invalide", func(t *testing.T) {
		f := validForm(room)
		f.takenAt = "hier"
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 400)
	})
	t.Run("fichier absent", func(t *testing.T) {
		f := validForm(room)
		f.file = nil
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 400)
	})
	t.Run("non JPEG", func(t *testing.T) {
		f := validForm(room)
		f.file = []byte("GIF89a....")
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 415)
	})
	t.Run("trop gros", func(t *testing.T) {
		f := validForm(room)
		f.file = jpegBytes(10<<20 + 1)
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 413)
	})
	t.Run("10 Mo exactement", func(t *testing.T) {
		f := validForm(room)
		f.id = "11111111-1234-4abc-8def-0123456789ab"
		f.file = jpegBytes(10 << 20)
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 201)
	})
	t.Run("pièce inconnue", func(t *testing.T) {
		f := validForm("00000000-0000-4000-8000-00000000dead")
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 404)
	})
	t.Run("pièce d'une autre visite", func(t *testing.T) {
		wantCode(t, uploadPhoto(t, router, "maison-b", devB, validForm(room)), 404)
	})
	t.Run("id déjà utilisé par une autre visite", func(t *testing.T) {
		f := validForm("")
		f.id = "22222222-1234-4abc-8def-0123456789ab"
		wantCode(t, uploadPhoto(t, router, "maison-a", devA, f), 201)
		wantCode(t, uploadPhoto(t, router, "maison-b", devB, f), 409)
	})
	t.Run("visite clôturée", func(t *testing.T) {
		createVisit(t, router, "maison-c", devA)
		body := `{"ops":[{"op_id":"c1","type":"close_visit","client_ts":1,"payload":{}}]}`
		wantCode(t, do(t, router, "POST", "/api/visits/maison-c/ops", devA, body), 200)
		f := validForm("")
		f.id = "33333333-1234-4abc-8def-0123456789ab"
		wantCode(t, uploadPhoto(t, router, "maison-c", devA, f), 409)
	})
}

func TestPhotoDownloadErrors(t *testing.T) {
	router, root := newTestRouterWithPhotos(t)
	createVisit(t, router, "maison-a", devA)
	createVisit(t, router, "maison-b", devB)
	wantCode(t, uploadPhoto(t, router, "maison-a", devA, validForm("")), 201)
	url := "/api/visits/maison-a/photos/" + testPhotoID

	wantCode(t, do(t, router, "GET", url, "", ""), 400)
	wantCode(t, do(t, router, "GET", url, devC, ""), 403)
	wantCode(t, do(t, router, "GET", "/api/visits/maison-a/photos/inconnu", devA, ""), 404)
	// Photo d'une autre visite.
	wantCode(t, do(t, router, "GET", "/api/visits/maison-b/photos/"+testPhotoID, devB, ""), 404)

	// Fichier disparu du disque.
	if err := os.RemoveAll(filepath.Join(root, "maison-a")); err != nil {
		t.Fatal(err)
	}
	wantCode(t, do(t, router, "GET", url, devA, ""), 404)
}

// countFiles compte les fichiers sous dir (0 si dir n'existe pas).
func countFiles(t *testing.T, dir string) int {
	t.Helper()
	n := 0
	_ = filepath.Walk(dir, func(_ string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func TestRefusedPhotoUploadLeavesNoFile(t *testing.T) {
	router, root := newTestRouterWithPhotos(t)
	createVisit(t, router, "maison-a", devA)
	createVisit(t, router, "maison-b", devB)
	createVisit(t, router, "maison-c", devA)
	body := `{"ops":[{"op_id":"c1","type":"close_visit","client_ts":1,"payload":{}}]}`
	wantCode(t, do(t, router, "POST", "/api/visits/maison-c/ops", devA, body), 200)

	wantCode(t, uploadPhoto(t, router, "maison-c", devA, validForm("")), 409)
	if n := countFiles(t, filepath.Join(root, "maison-c")); n != 0 {
		t.Errorf("visite clôturée : %d fichier(s) écrit(s)", n)
	}

	wantCode(t, uploadPhoto(t, router, "maison-a", devA, validForm("")), 201)
	wantCode(t, uploadPhoto(t, router, "maison-b", devB, validForm("")), 409)
	if n := countFiles(t, filepath.Join(root, "maison-b")); n != 0 {
		t.Errorf("id déjà pris : %d fichier(s) écrit(s)", n)
	}
}

func TestPhotoDownloadHeaders(t *testing.T) {
	router := newTestRouter(t)
	createVisit(t, router, "maison-a", devA)
	wantCode(t, uploadPhoto(t, router, "maison-a", devA, validForm("")), 201)
	get := do(t, router, "GET", "/api/visits/maison-a/photos/"+testPhotoID, devA, "")
	wantCode(t, get, http.StatusOK)
	for name, want := range map[string]string{
		"Content-Type":           "image/jpeg",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "private, max-age=31536000, immutable",
	} {
		if got := get.Header().Get(name); got != want {
			t.Errorf("%s = %q, attendu %q", name, got, want)
		}
	}
}
