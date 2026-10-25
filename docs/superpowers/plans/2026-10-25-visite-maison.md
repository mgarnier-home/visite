# Visite — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire l'application de visite de maison décrite dans la spec : back Go + SQLite,
front Angular PWA hors ligne, export CSV, livrée en une image Docker.

**Architecture:** Un binaire Go sert l'API JSON sous `/api`, `/version`, et le build Angular
embarqué. Le front applique chaque action localement (IndexedDB), la met dans une file
d'opérations, et la synchronise avec le serveur, qui applique les opérations sans doublon et en
dernière écriture gagnante, et filtre les notes et commentaires des autres appareils.

**Tech Stack:** Go 1.26.4, gorilla/mux, `github.com/mgarnier-home/utils` v1.2.0,
`modernc.org/sqlite` ; Node 24.16.0, Angular (version stable courante), Angular Material,
`@angular/service-worker`, Dexie, Vitest (`ng test`), `fake-indexeddb`, Playwright ; Taskfile,
Docker buildx.

**Spec:** `docs/superpowers/specs/2026-10-25-visite-maison-design.md`

## Global Constraints

- Code (fichiers, identifiants) en anglais ; commentaires, messages d'interface et docs en français.
- Commits au format Conventional Commits. **Commit seulement avec l'accord explicite du
  propriétaire** (`/mnt/dev/CLAUDE.md`) : au début de l'exécution, demander une fois si les
  commits par tâche sont autorisés ; sinon sauter les étapes « Commit ».
- `.tool-versions` à la racine : `golang 1.26.4` et `nodejs 24.16.0`.
- Variables d'environnement : `VISITE_SERVER_PORT` (défaut `8080`), `VISITE_DB_PATH` (défaut
  `./visite.db`), `VISITE_PHOTOS_DIR` (défaut `./photos`). Rien d'autre, aucun secret.
- Code de visite : `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`.
- Limites : 500 opérations et 1 Mo par lot ; 10 Mo par photo ; JPEG seulement.
- Notes de 1 à 5 ou `null` (N/A) ; `case` ∈ `ok`, `problem`, `na` ; `constat` ∈ options ∪ `na`.
- Frais de notaire : 7,5 % du prix. Score pondéré arrondi au dixième, sur 5, N/A exclus.
- Photos : 2000 px au plus sur le grand côté, JPEG qualité 0,8, nom
  `AAAAMMJJ-HHMMSS-<8 premiers hex de l'UUID>.jpg`, heure locale du téléphone.
- Synchro : délais de nouvelle tentative 1, 2, 4, 8, 16, 30 s (plafond 30 s) ; récupération des
  changements toutes les 5 s, en ligne et au premier plan.
- Images Docker : `linux/amd64` et `linux/arm64`, registre et version explicites.
- Ne jamais exécuter `orchestrator-cli up/down/restart`, `git push`, ni toucher `/mnt/secrets` et
  `/mnt/docker-data`.

## Contrat JSON (partagé par le back et le front)

Ces formes sont la seule interface entre les tâches back et front. Noms de champs exacts.
Champs absents ⇒ `null`. Dates en RFC 3339. `client_ts`, `updated_at` en millisecondes Unix.

```ts
type SectionKind = 'room' | 'per_bedroom' | 'topic' | 'summary';
type PointType = 'note' | 'constat' | 'case';

interface Template { version: number; packing_list: string; sections: TemplateSection[] }
interface TemplateSection { id: string; name: string; kind: SectionKind; position: number;
  points: TemplatePoint[]; questions: TemplateQuestion[] }
interface TemplatePoint { id: string; label: string; type: PointType; options: string[];
  weight: number; position: number }
interface TemplateQuestion { id: string; text: string; position: number }

interface Fiche { address: string; price_eur: number|null; living_area_m2: number|null;
  floor_area_m2: number|null; land_area_m2: number|null; visit_at: string|null;
  agent_name: string|null; agent_phone: string|null; agent_email: string|null;
  construction_year: number|null; dpe_energy: string|null; dpe_ges: string|null;
  rooms_count: number|null; bedrooms_count: number|null; listing_url: string|null;
  heating_type: string|null }

interface VisitInfo { code: string; is_creator: boolean; created_at: string;
  closed_at: string|null; fiche: Fiche; packing_list: string; participants: number }
interface Room { id: string; name: string; dir_name: string; kind: SectionKind;
  position: number; hidden: boolean }
interface Point { id: string; room_id: string; label: string; type: PointType;
  options: string[]; weight: number; position: number }
interface Question { id: string; room_id: string; text: string; position: number }
interface SharedValue { target_id: string; field: SharedField; value: unknown;
  updated_at: number; author: number }            // author = numéro du participant
type SharedField = 'value' | 'blocking' | 'works_eur' | 'answer' | 'asked' | 'area_m2';
interface Rating { point_id: string; value: number|null; updated_at: number }   // les miennes
interface Comment { room_id: string; text: string; updated_at: number }         // les miens
interface Photo { id: string; room_id: string|null; author: number; taken_at: string }

// GET /api/visits/{code} et GET …/changes?since=N (changes : seulement les lignes seq > N)
interface VisitState { seq: number; me: { number: number }; visit: VisitInfo;
  rooms: Room[]; points: Point[]; questions: Question[]; shared: SharedValue[];
  ratings: Rating[]; comments: Comment[]; photos: Photo[] }

type OpType = 'add_room' | 'rename_room' | 'hide_room' | 'add_point' | 'add_question'
  | 'set_rating' | 'set_comment' | 'set_shared' | 'set_fiche' | 'close_visit';
interface Op { op_id: string; type: OpType; client_ts: number; payload: object }
interface OpResult { op_id: string; result: 'applied' | 'duplicate' | 'rejected';
  reason?: 'closed' | 'forbidden' | 'not_found' | 'invalid' }
interface OpsResponse { seq: number; results: OpResult[] }

interface CreateVisitRequest { code: string; fiche: Fiche }   // réponse 201 : VisitState
interface JoinResponse { number: number }
interface ExistsResponse { exists: boolean }
interface ErrorResponse { error: string }
```

Payloads : `add_room {id, name, from_section_id|null}` ; `rename_room {room_id, name}` ;
`hide_room {room_id}` ; `add_point {id, room_id, label, type, options}` ;
`add_question {id, room_id, text}` ; `set_rating {point_id, value}` ;
`set_comment {room_id, text}` ; `set_shared {target_id, field, value}` ;
`set_fiche {fields: Partial<Fiche>}` ; `close_visit {}`.

Identité : en-tête `X-Device-Id` (UUID), ou paramètre `?d=<uuid>` pour les `GET` lancés par
`<img>` et les téléchargements. Absent ou invalide ⇒ `400`.

## Review Focus

1. Un même lot renvoyé pendant que le premier envoi est encore en vol (réseau lent, l'app
   relance) : chaque opération n'est appliquée qu'une fois → test concurrent, Task 6.
2. Un commentaire ou une réponse contenant `;`, des guillemets ou des retours à la ligne : le CSV
   reste valide dans Sheets → test d'échappement, Task 9.
3. Un code tapé « Maison-Nantes-Centre » ou avec des espaces autour : il retrouve
   `maison-nantes-centre` → test `normalizeCode`, Task 14.
4. Une pièce nommée « ??? » ou « Salle d'eau é » : un `dir_name` non vide et sûr (`piece`,
   `salle-d-eau-e`) → test `Slugify`, Task 2.
5. Le créateur change le nombre de chambres après la création : aucune pièce n'est ajoutée ni
   retirée (on ajoute une chambre à la main) → test, Task 6.

---

## Partie 1 — Back

### Task 1: Squelette du back

**Files:**
- Create: `.tool-versions`, `.gitignore`, `taskfile.yml`
- Create: `backend/go.mod`, `backend/main.go`, `backend/config.go`
- Create: `backend/api/router.go`, `backend/api/router_test.go`

**Interfaces:**
- Produces: `type Config struct { ServerPort int; DBPath string; PhotosDir string }` (étiquettes
  `key`/`default-value` de `utils/config`, valeurs des Global Constraints) ;
  `api.NewRouter(d api.Deps) *mux.Router` avec `type Deps struct { Store *store.Store;
  Photos photos.Store; Log *logger.Logger; Now func() time.Time }` (les champs `Store` et
  `Photos` sont ajoutés par les tâches 3 et 8 ; ici `Deps` n'a que `Log` et `Now`).

- [ ] **Step 1: Initialiser** — `go mod init github.com/mgarnier-home/visite` dans `backend/`,
  `go get github.com/mgarnier-home/utils@v1.2.0 github.com/gorilla/mux@v1.8.1`.
  `.gitignore` : `backend/web/dist/*` sauf `.gitkeep`, `frontend/node_modules`, `frontend/dist`,
  `*.db`, `photos/`, `bin/`, `dist/`.
- [ ] **Step 2: Test qui échoue** — `TestVersionRouteResponds` : `httptest` sur
  `NewRouter(Deps{})`, `GET /version` → `200`.
- [ ] **Step 3: Vérifier l'échec** — `cd backend && go test ./api/ -run TestVersionRouteResponds -v` → FAIL (`NewRouter` indéfini).
- [ ] **Step 4: Implémenter** `NewRouter` (appelle `version.SetupVersionRoute`, sous-routeur
  `/api` vide, middleware `utilshttp.LogRequestMiddleware` si `Log` non nul) et `main.go`
  (`logger.InitAppLogger("visite")`, `config.GetConfig(&cfg)`, `http.ListenAndServe`).
  `taskfile.yml` : tâches `build` (ldflags `buildinfo` comme `orchestrator-cli`) et `test`
  (`go test ./...` dans `backend`).
- [ ] **Step 5: Vérifier** — `go test ./...`, `go vet ./...` → PASS.
- [ ] **Step 6: Commit** — `chore: scaffold backend`

### Task 2: Modèle, validation et slugs

**Files:**
- Create: `backend/model/types.go` (structs Go du Contrat JSON, étiquettes `json` identiques)
- Create: `backend/model/validate.go`, `backend/model/validate_test.go`
- Create: `backend/model/compute.go`, `backend/model/compute_test.go`

**Interfaces:**
- Produces:
  - types `Template`, `TemplateSection`, `TemplatePoint`, `TemplateQuestion`, `Fiche`
    (pointeurs pour les champs nullables), `VisitInfo`, `Room`, `Point`, `Question`,
    `SharedValue`, `Rating`, `Comment`, `Photo`, `VisitState` ;
  - `var ErrInvalid = errors.New("invalid")` (les erreurs de validation l'enveloppent) ;
  - `func ValidCode(code string) bool` ;
  - `func Slugify(name string) string` ;
  - `func (t Template) Validate() error` ;
  - `func (f Fiche) Validate() error` ;
  - `func ValidSharedValue(field string, targetIsPoint bool, p *Point, raw json.RawMessage) error` ;
  - `func NotaryFees(price float64) float64` ; `func PricePerM2(f Fiche) *float64` ;
  - `func WeightedScore(points []Point, ratings map[string]*int) *float64`.

- [ ] **Step 1: Tests qui échouent** (`validate_test.go`, table-driven) :
  - `TestValidCode` : `maison-nantes-centre` ✓ ; `ab` ✗ (trop court) ; `-abc`, `abc-` ✗ ;
    `Maison` ✗ ; 60 caractères ✓, 61 ✗.
  - `TestSlugify` : `Cuisine`→`cuisine` ; `Chambre 2`→`chambre-2` ;
    `Salle d'eau é`→`salle-d-eau-e` ; `???`→`piece` ; `  Garage  `→`garage` ;
    `Séjour / salon`→`sejour-salon`.
  - `TestTemplateValidate` : `constat` sans options ✗ ; `note` avec options ✗ ; type inconnu ✗ ;
    kind inconnu ✗ ; poids ≤ 0 ✗ ; modèle de la seed ✓ (ajouté à la Task 4).
  - `TestFicheValidate` : adresse vide ✗ ; `dpe_energy` = `H` ✗ ; `bedrooms_count` = 21 ✗ ;
    prix négatif ✗ ; fiche avec seulement l'adresse ✓.
  - `TestValidSharedValue` : `case` + `"ok"` ✓, `"bof"` ✗ ; `constat` + option ✓, `"na"` ✓,
    autre ✗ ; `value` sur un point `note` ✗ ; `blocking` `true` ✓, `"oui"` ✗ ;
    `works_eur` `-1` ✗ ; `answer` sur une question ✓, sur un point ✗ ; `area_m2` sur une
    pièce ✓.
- [ ] **Step 2: Tests qui échouent** (`compute_test.go`) :
  `NotaryFees(300000)` = `22500` ; `PricePerM2` 300000/120 = `2500`, `nil` si surface nulle ou
  absente ; `WeightedScore` avec poids 3/1/2 et notes 5/3/N/A → `(5*3+3*1)/4 = 4.5` ; aucune
  note → `nil` ; points non `note` ignorés ; arrondi au dixième (`4.25`→`4.3`).
- [ ] **Step 3: Vérifier l'échec** — `go test ./model/ -v` → FAIL.
- [ ] **Step 4: Implémenter.** `Slugify` : minuscules, translittération des accents latins via
  `golang.org/x/text/unicode/norm` (NFD puis retrait des marques), tout caractère hors `[a-z0-9]`
  devient `-`, tirets fusionnés et retirés aux bords, `piece` si vide, tronqué à 60.
- [ ] **Step 5: Vérifier** — `go test ./model/ -v` → PASS.
- [ ] **Step 6: Commit** — `feat: add domain model and validation`

### Task 3: Store SQLite, migrations et modèle global

**Files:**
- Create: `backend/store/store.go`, `backend/store/migrations/001_init.sql`
- Create: `backend/store/template.go`, `backend/store/template_test.go`
- Create: `backend/store/testutil_test.go` (`newTestStore(t) *Store` sur un fichier dans `t.TempDir()`)

**Interfaces:**
- Consumes: `model.Template`, `model.Template.Validate`.
- Produces:
  - `func Open(path string) (*Store, error)` (active `foreign_keys`, mode WAL, `busy_timeout`
    5000, applique les migrations embarquées dans l'ordre, table `schema_migrations`) ;
  - `func (s *Store) Close() error` ;
  - `var ErrNotFound, ErrConflict, ErrVersionConflict, ErrClosed` ;
  - `func (s *Store) GetTemplate(ctx) (model.Template, error)` ;
  - `func (s *Store) SaveTemplate(ctx, t model.Template) (model.Template, error)` : `Validate`,
    puis `ErrVersionConflict` si `t.Version` ≠ version courante, sinon remplace toutes les lignes
    et renvoie le modèle avec `Version+1` ;
  - `func (s *Store) SeedTemplateIfEmpty(ctx, t model.Template) error`.

`001_init.sql` crée toutes les tables de la spec §5, avec ces précisions : une colonne `seq` sur
`visit_rooms`, `visit_points`, `visit_questions`, `ratings`, `room_comments`, `shared_values`,
`photos` ; `visits` reçoit `packing_list` (copie du modèle), `fiche_ts` (JSON
`{champ: [updated_at, device_id]}`) et `seq_changed` (seq de la dernière modification de la
fiche ou de la clôture) ; `visit_seq` est une colonne `seq` de `visits`.

- [ ] **Step 1: Tests qui échouent** :
  `TestOpenAppliesMigrationsOnce` (ouvrir deux fois le même fichier → pas d'erreur, une ligne
  dans `schema_migrations`) ; `TestTemplateEmptyByDefault` (version 0, aucune section) ;
  `TestSaveTemplateIncrementsVersion` ; `TestSaveTemplateRejectsStaleVersion`
  (`errors.Is(err, ErrVersionConflict)`) ; `TestSaveTemplateRejectsInvalid`
  (`errors.Is(err, model.ErrInvalid)`) ; `TestSaveTemplateKeepsOrder` (positions relues
  triées).
- [ ] **Step 2: Vérifier l'échec** — `go test ./store/ -v` → FAIL.
- [ ] **Step 3: Implémenter** avec `modernc.org/sqlite` (`database/sql`, pilote `sqlite`).
- [ ] **Step 4: Vérifier** — `go test ./store/ -v` → PASS.
- [ ] **Step 5: Commit** — `feat: add sqlite store and template persistence`

### Task 4: Modèle initial (seed)

**Files:**
- Create: `backend/seed/template.json`, `backend/seed/seed.go`, `backend/seed/seed_test.go`
- Modify: `backend/main.go` (appel de `SeedTemplateIfEmpty` au démarrage)
- Modify: `backend/model/validate_test.go` (cas « modèle de la seed ✓ »)

**Interfaces:**
- Produces: `func seed.Template() (model.Template, error)` (JSON embarqué).

Contenu : exactement l'annexe A de la spec, dans cet ordre : Questions générales (`topic`),
Extérieur et structure, Entrée, Cuisine, Salon / séjour, Chambre (`per_bedroom`, nom
« Chambre »), Salle de bain, Toilettes, Garage, Combles, cave, buanderie, chaufferie,
Environnement et quartier (`room`), Bilan (`summary`). Les questions « les N de la checklist »
sont recopiées mot pour mot de la section correspondante de `checklist-visite-maison.md`.
`packing_list` = le texte « À emporter » de l'annexe. Identifiants stables et lisibles
(`sec-cuisine`, `pt-cuisine-1`, `q-cuisine-1`). Poids 1 partout sauf le bilan (annexe).
Le « Note globale de la pièce » n'est **pas** dans la seed (ajouté à la création de visite).

- [ ] **Step 1: Tests qui échouent** — `TestSeedTemplate` : 12 sections dans l'ordre ci-dessus ;
  `Validate()` sans erreur ; Cuisine a 8 points dont « Hotte » `constat` avec 3 options ;
  Questions générales a 0 point et 18 questions ; Chambre est `per_bedroom` avec 9 points et
  0 question ; Bilan a 8 points, poids d'Emplacement = 3 ; `packing_list` non vide.
- [ ] **Step 2: Vérifier l'échec** — `go test ./seed/ -v` → FAIL.
- [ ] **Step 3: Écrire `template.json` et `seed.go`** (`//go:embed template.json`).
- [ ] **Step 4: Vérifier** — `go test ./... -v` → PASS.
- [ ] **Step 5: Commit** — `feat: add initial template from checklist`

### Task 5: Création de visite et participants

**Files:**
- Create: `backend/store/visits.go`, `backend/store/snapshot.go`, `backend/store/visits_test.go`

**Interfaces:**
- Consumes: `model.ValidCode`, `model.Fiche.Validate`, `model.Slugify`, `GetTemplate`.
- Produces:
  - `func (s *Store) VisitExists(ctx, code string) (bool, error)` ;
  - `func (s *Store) CreateVisit(ctx, code string, f model.Fiche, creatorDevice string, now time.Time) error`
    (`model.ErrInvalid`, `ErrConflict`) ;
  - `func (s *Store) Join(ctx, code, device string, now time.Time) (int, error)` (idempotent,
    `ErrNotFound`) ;
  - `func (s *Store) ParticipantNumber(ctx, code, device string) (int, error)` (`ErrNotFound`
    si non participant) ;
  - interne, réutilisé par la Task 6 : `func copySection(tx *sql.Tx, code string,
    sec model.TemplateSection, roomID, name string, position int, seq int64) error` et
    `func uniqueDirName(tx *sql.Tx, code, base string) (string, error)`.

- [ ] **Step 1: Tests qui échouent** :
  - `TestCreateVisitCopiesTemplate` : avec la seed et `bedrooms_count` = 3 → pièces dans
    l'ordre, « Chambre 1 » à « Chambre 3 » à la place de la section Chambre, `dir_name`
    `chambre-1`…`chambre-3`, `cuisine` ; chaque pièce `room`/`per_bedroom` a en position 0 un
    point `note` « Note globale de la pièce » ; Questions générales et Bilan n'en ont pas ;
    `packing_list` copié.
  - `TestCreateVisitWithoutBedrooms` : `bedrooms_count` nul ou 0 → aucune chambre.
  - `TestCreateVisitRejectsTakenCode` → `ErrConflict` ; `TestCreateVisitRejectsBadCode` →
    `model.ErrInvalid`.
  - `TestCreatorIsParticipantOne` ; `TestJoinNumbersInOrder` (2, puis 3) ;
    `TestJoinIsIdempotent` (même appareil → même numéro) ; `TestJoinUnknownVisit` →
    `ErrNotFound`.
  - `TestTemplateChangeDoesNotAffectVisit` : modifier le modèle après création ne change pas
    les points de la visite.
- [ ] **Step 2: Vérifier l'échec** — `go test ./store/ -run 'Visit|Join|Creator' -v` → FAIL.
- [ ] **Step 3: Implémenter** dans une transaction ; les UUID serveur via `github.com/google/uuid`.
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: create visits from template snapshot`

### Task 6: Application des opérations

**Files:**
- Create: `backend/store/tx.go` (primitives transactionnelles)
- Create: `backend/ops/ops.go`, `backend/ops/apply.go`, `backend/ops/apply_test.go`

**Interfaces:**
- Consumes: `copySection`, `uniqueDirName`, `model.ValidSharedValue`, `model.Fiche.Validate`.
- Produces:
  - `store` : `func (s *Store) InTx(ctx, fn func(*Tx) error) error` et sur `*Tx` :
    `Visit(code) (VisitRow, error)` (`Closed bool`, `CreatorDevice string`, `Fiche model.Fiche`) ;
    `OpSeen(opID) (bool, error)` ; `RecordOp(OpRecord) error` (clé primaire `op_id` : une
    violation renvoie `ErrConflict`) ; `NextSeq(code) (int64, error)` ;
    `Room/Point/Question(id) (…, visitCode string, error)` ;
    `InsertRoom`, `CopySectionAsRoom(code, roomID, name, sectionID, seq)`, `RenameRoom`,
    `HideRoom`, `InsertPoint`, `InsertQuestion` ;
    `GetLWW(kind LWWKind, key LWWKey) (ts int64, device string, ok bool, err error)` et
    `PutLWW(kind, key, value json.RawMessage, ts int64, device string, seq int64) error` avec
    `LWWKind` ∈ `KindRating`, `KindComment`, `KindShared`, `KindFiche` ;
    `CloseVisit(code, at time.Time, seq int64) error`.
  - `ops` : `type Op struct { OpID string; Type string; ClientTS int64; Payload json.RawMessage }`
    (étiquettes du contrat) ; `type Result struct { OpID, Result, Reason string }` ;
    `func ApplyBatch(ctx, s *store.Store, code, device string, batch []Op, now time.Time) ([]Result, int64, error)`
    (renvoie aussi le `seq` courant) ;
    `func Wins(storedTS int64, storedDev string, opTS int64, opDev string) bool`.

Règles exactes : spec §7.1, dans l'ordre 1 → 4. Une transaction par opération.
`set_rating` seulement sur un point `note` (sinon `invalid`), clé `(point_id, device)`.
`set_comment` clé `(room_id, device)`. `set_fiche` : un `GetLWW/PutLWW` par champ présent
(`KindFiche`, clé `(code, champ)`), réservé au créateur ; changer `bedrooms_count` ne crée ni ne
retire de pièce. `add_room` avec `from_section_id` copie les points et questions de la section
du modèle courant (et ajoute la note globale si `room`/`per_bedroom`) ; sans, pièce vide de kind
`room` avec sa note globale. Un `add_*` dont l'`id` existe déjà ⇒ `invalid`.

- [ ] **Step 1: Tests qui échouent** (`apply_test.go`, visite créée avec la seed, appareils A
  créateur et B participant) :
  - `TestWins` (table) : ts plus récent gagne ; égalité → plus grand `device` gagne.
  - `TestDuplicateOpIgnored` : même `op_id` deux fois → `applied` puis `duplicate`, une seule
    ligne.
  - `TestConcurrentDuplicateBatch` (Review Focus 1) : le même lot envoyé par deux goroutines en
    parallèle → pour chaque `op_id`, exactement un `applied` et un `duplicate`.
  - `TestSharedLastWriteWins` : B écrit `answer` à ts 200 puis A à ts 100 → valeur de B ;
    les deux `applied`.
  - `TestRatingOnlyOnNote` : `set_rating` sur un point `case` → `rejected/invalid` ; note 6 →
    `invalid` ; `null` → `applied`.
  - `TestFicheOnlyCreator` : B `set_fiche` → `forbidden` ; A → `applied`.
  - `TestBedroomsChangeKeepsRooms` (Review Focus 5) : A passe `bedrooms_count` de 3 à 4 →
    toujours 3 chambres.
  - `TestClosedVisitRejects` : après `close_visit` par A, `set_rating` de B → `closed` ;
    `close_visit` par B → `forbidden`.
  - `TestUnknownTarget` → `not_found` ; cible d'une autre visite → `not_found`.
  - `TestAddRoomFromSection` : copie de « Salle de bain » → `dir_name` `salle-de-bain-2`,
    9 points (8 + note globale), 4 questions.
  - `TestRejectedDoesNotBlockBatch` : lot [invalide, valide] → [`rejected`, `applied`].
  - `TestSeqIncrements` : chaque `applied` avec effet incrémente le `seq` renvoyé ; un
    `duplicate` non.
- [ ] **Step 2: Vérifier l'échec** — `go test ./ops/ -v` → FAIL.
- [ ] **Step 3: Implémenter** `tx.go` puis `apply.go` (un `switch` sur `Type`, décodage du
  payload, validation, droits, LWW, écriture, `RecordOp`). Une violation de clé primaire dans
  `RecordOp` pendant une course ⇒ annuler la transaction et répondre `duplicate`.
- [ ] **Step 4: Vérifier** — `go test ./... -race` → PASS.
- [ ] **Step 5: Commit** — `feat: apply sync operations with last-write-wins`

### Task 7: État et changements filtrés

**Files:**
- Create: `backend/store/state.go`, `backend/store/state_test.go`

**Interfaces:**
- Consumes: ops (les tests écrivent via `ops.ApplyBatch` ; `state_test.go` est dans le paquet
  `store_test` pour éviter le cycle d'import, avec sa propre fonction d'ouverture d'un store
  temporaire puisque `newTestStore` est interne au paquet `store`).
- Produces: `func (s *Store) State(ctx, code, device string, since int64) (model.VisitState, error)`
  (`since` = 0 : tout ; sinon seulement les lignes `seq > since` ; `visit` toujours présent ;
  `ErrNotFound`).

- [ ] **Step 1: Tests qui échouent** :
  - `TestStateHidesOthersRatingsAndComments` : A et B notent et commentent → l'état de B ne
    contient que la note et le commentaire de B.
  - `TestStateSharesSharedValues` : `answer` de A visible par B avec `author` = 1.
  - `TestChangesSince` : après un `seq` N, une seule modification → `changes` ne renvoie que
    cette ligne et `seq` = N+1.
  - `TestStateIsCreatorFlag` ; `TestStateParticipantsCount` ; `TestStateIncludesHiddenRooms`
    (`hidden: true`, le front filtre).
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: serve filtered visit state and changes`

### Task 8: Stockage des photos

**Files:**
- Create: `backend/photos/photos.go`, `backend/photos/photos_test.go`
- Create: `backend/store/photos.go` (+ cas dans `backend/store/state_test.go`)

**Interfaces:**
- Produces:
  - `type Store interface { Put(rel string, r io.Reader) error; Open(rel string) (io.ReadCloser, error) }` ;
  - `type FS struct{ Root string }` qui l'implémente (crée les dossiers, écrit dans un fichier
    temporaire puis renomme) ;
  - `func PhotoPath(visitCode, dirName string, takenAt time.Time, id string) string`
    (`dirName` vide ⇒ photo globale) ;
  - `func CheckJPEG(r io.Reader) (io.Reader, error)`, `var ErrNotJPEG` ;
  - `store` : `func (s *Store) AddPhoto(ctx, p PhotoRecord) (created bool, err error)`
    (idempotent par `id`, incrémente le `seq`, refuse si visite clôturée : `ErrClosed`) ;
    `func (s *Store) PhotoPathByID(ctx, code, id string) (string, error)` ;
    `func (s *Store) RoomDirName(ctx, code, roomID string) (string, error)`.

- [ ] **Step 1: Tests qui échouent** :
  `TestPhotoPath` : (`maison-nantes-centre`, `cuisine`, `2026-10-25T14:35:20+02:00`,
  `e5f6a7b8-…`) → `maison-nantes-centre/cuisine/20261025-143520-e5f6a7b8.jpg` ; sans pièce →
  `maison-nantes-centre/20261025-143520-e5f6a7b8.jpg`.
  `TestFSPutCreatesTree` (`t.TempDir()`). `TestCheckJPEG` : octets `FF D8 FF …` ✓, PNG ✗.
  `TestFSRejectsEscapingPath` : `../x.jpg` → erreur.
  `TestAddPhotoIdempotent`, `TestAddPhotoClosedVisit`, `TestStateListsPhotos`.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: store photos per visit and room`

### Task 9: Export CSV

**Files:**
- Create: `backend/store/export.go` (`func (s *Store) ExportData(ctx, code string) (export.Data, error)`)
- Create: `backend/export/export.go`, `backend/export/export_test.go`,
  `backend/export/testdata/visit.golden.csv`

**Interfaces:**
- Consumes: `model.NotaryFees`, `model.PricePerM2`, `model.WeightedScore`.
- Produces:
  - `type Data struct { Code string; Fiche model.Fiche; Participants int; Rooms []model.Room;
    Points []model.Point; Questions []model.Question; Shared map[string]map[string]json.RawMessage;
    Ratings map[string]map[int]*int; Comments map[string]map[int]string; Year int }`
    (`Shared[target][field]`, `Ratings[point][participant]`, `Comments[room][participant]`) ;
  - `func Rows(d Data) [][]string` ;
  - `func Write(w io.Writer, rows [][]string, sep rune, bom bool) error` (via `encoding/csv`).

Colonnes, ordre des lignes et rendu des valeurs : spec §9, à la lettre. Libellés des lignes de
fiche : les noms de champs du contrat, puis `prix_m2`, `frais_notaire`, `age_batiment`.
Pièces masquées exclues.

- [ ] **Step 1: Tests qui échouent** :
  - `TestRowsGolden` : une visite fixe (2 participants, une pièce avec un `note`, un `case`
    bloquant avec travaux, un `constat`, une question posée, deux commentaires, un bilan) →
    `Write(…, ';', true)` égal octet pour octet à `testdata/visit.golden.csv` (BOM en tête).
  - `TestEscaping` (Review Focus 2) : commentaire `a;b "c"\nd` → relu par `csv.NewReader` avec
    `Comma=';'`, le champ est intact.
  - `TestTabNoBOM` : `Write(…, '\t', false)` ne commence pas par le BOM.
  - `TestHiddenRoomExcluded`.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Écrire le golden à la main** à partir de la spec, puis implémenter `Rows` et
  `Write`.
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: export visit as csv`

### Task 10: API des visites

**Files:**
- Create: `backend/api/device.go`, `backend/api/visits.go`, `backend/api/json.go`,
  `backend/api/visits_test.go`
- Modify: `backend/api/router.go` (`Deps.Store`)

**Interfaces:**
- Consumes: Tasks 5 à 7.
- Produces: routes `GET /api/visits/{code}/exists`, `POST /api/visits`,
  `POST /api/visits/{code}/join`, `GET /api/visits/{code}`,
  `GET /api/visits/{code}/changes?since=N`, `POST /api/visits/{code}/ops`, réponses du Contrat
  JSON ; middleware `deviceID(r) (string, bool)` (en-tête ou `?d=`) ; garde « participant »
  (`403`) pour toutes les routes sauf `exists`, `POST /api/visits` et `join` ;
  erreurs `{"error": "..."}`.

- [ ] **Step 1: Tests qui échouent** (`httptest`, store temporaire avec la seed) :
  sans `X-Device-Id` → `400` ; création → `201` et `VisitState` avec `me.number` = 1 ;
  code pris → `409` ; code invalide → `400` ; `exists` ; `join` inconnu → `404` ;
  `GET` par un non-participant → `403` ; `ops` → `200` avec `results` ; lot de 501 opérations
  → `413` ; corps > 1 Mo → `413` ; `changes?since=abc` → `400`.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter** (`http.MaxBytesReader` pour la limite de 1 Mo).
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add visits http api`

### Task 11: API des photos, de l'export et du modèle

**Files:**
- Create: `backend/api/photos.go`, `backend/api/export.go`, `backend/api/template.go`,
  `backend/api/photos_test.go`, `backend/api/export_test.go`, `backend/api/template_test.go`
- Modify: `backend/api/router.go` (`Deps.Photos`)

**Interfaces:**
- Consumes: Tasks 3, 8, 9.
- Produces: `POST /api/visits/{code}/photos` (multipart `id`, `room_id`, `taken_at`, `file` ;
  `201` créée, `200` déjà présente, `409` visite clôturée, `415` non-JPEG, `413` > 10 Mo,
  `404` pièce inconnue) ; `GET /api/visits/{code}/photos/{id}` (`image/jpeg`) ;
  `GET /api/visits/{code}/export.csv?sep=tab` (`sep=tab` ⇒ tabulations sans BOM, sinon `;` avec
  BOM ; `Content-Type: text/csv; charset=utf-8`, `Content-Disposition` `<code>.csv`) ;
  `GET /api/template`, `PUT /api/template` (`409` sur `ErrVersionConflict`, `400` sur
  `ErrInvalid`).

- [ ] **Step 1: Tests qui échouent** : un test par code de retour ci-dessus ; la photo
  envoyée se relit identique par `GET …?d=<device>` ; l'export contient l'en-tête `visite;pièce;`.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.** Le fichier est écrit **avant** `AddPhoto` ; si `AddPhoto`
  échoue, le fichier reste (inoffensif, réécrit au prochain envoi).
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add photos, export and template api`

### Task 12: Front embarqué et câblage

**Files:**
- Create: `backend/web/web.go`, `backend/web/web_test.go`, `backend/web/dist/.gitkeep`
- Modify: `backend/main.go`, `backend/api/router.go`, `taskfile.yml`

**Interfaces:**
- Produces: `func web.Handler() http.Handler` (`//go:embed all:dist` : fichier existant servi
  tel quel, toute autre route renvoie `index.html`, `404` texte « frontend non construit » si
  `index.html` absent) ; montage en dernier sur le routeur, après `/api` et `/version` ; une route
  `/api/...` inconnue renvoie `404` JSON, jamais `index.html`. Tâche `task build` : build Angular
  puis copie de `frontend/dist/frontend/browser/*` dans `backend/web/dist/`, puis `go build`.

- [ ] **Step 1: Tests qui échouent** — `TestSPAFallback` (avec un `fstest.MapFS` injecté via
  une fonction interne `handler(fsys fs.FS)`) : `/v/abc` → `index.html` ; `/main.js` → le
  fichier ; `/api/nope` sur le routeur complet → `404` JSON.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter**, et dans `main.go` : `store.Open`, seed, `photos.FS{Root}`,
  `api.NewRouter`.
- [ ] **Step 4: Vérifier** — `go test ./...`, `go vet ./...` → PASS ; `task build` puis lancer
  le binaire, `curl -s localhost:8080/version` → la version.
- [ ] **Step 5: Commit** — `feat: embed frontend and wire server`

---

## Partie 2 — Front

Toutes les commandes front se lancent dans `frontend/`. `ng test` signifie
`npx ng test --watch=false`.

### Task 13: Squelette Angular

**Files:**
- Create: `frontend/` via `npx @angular/cli@latest new frontend --routing --style=scss --ssr=false --skip-git`
- Create: `frontend/proxy.conf.json` (`/api` et `/version` → `http://localhost:8080`)
- Create: `frontend/src/test-setup.ts` (`import 'fake-indexeddb/auto'`), référencé par la config
  de test
- Modify: `taskfile.yml` (tâches `front:dev`, `front:test`)

- [ ] **Step 1:** `npx ng add @angular/material` (thème clair par défaut, typographie oui),
  `npx ng add @angular/pwa`, `npm i dexie`, `npm i -D fake-indexeddb`.
  `manifest.webmanifest` : nom « Visite », `display: standalone`, `lang: fr`.
  `index.html` : `lang="fr"`. Locale `fr` enregistrée (`registerLocaleData`).
- [ ] **Step 2: Vérifier** — `ng test` → PASS (test généré) ; `npx ng build` → succès,
  `dist/frontend/browser/ngsw.json` présent.
- [ ] **Step 3: Commit** — `chore: scaffold angular frontend`

### Task 14: Types, client API et identité

**Files:**
- Create: `src/app/core/api.types.ts` (le Contrat JSON, recopié tel quel)
- Create: `src/app/core/device-id.ts`, `src/app/core/code.ts`, `src/app/core/code.spec.ts`
- Create: `src/app/core/api.client.ts`, `src/app/core/api.client.spec.ts`

**Interfaces:**
- Produces:
  - `getDeviceId(): Promise<string>` (lu dans la table `meta` de Dexie — clé `device_id` —,
    créé avec `crypto.randomUUID()` s'il manque) ;
  - `normalizeCode(input: string): string` (trim, minuscules, espaces → `-`) ;
    `CODE_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/` ;
  - `ApiClient` (injectable, `HttpClient`, ajoute `X-Device-Id`) : `exists(code)`,
    `create(req: CreateVisitRequest): Promise<VisitState>`, `join(code): Promise<JoinResponse>`,
    `state(code)`, `changes(code, since)`, `sendOps(code, ops: Op[]): Promise<OpsResponse>`,
    `uploadPhoto(code, p: {id, room_id, taken_at, blob}): Promise<void>`,
    `photoUrl(code, id, device): string`, `exportCsv(code, sep: 'semicolon'|'tab'): Promise<Blob>`,
    `getTemplate()`, `putTemplate(t)`. Les erreurs HTTP remontent en `ApiError { status: number;
    message: string }`.

- [ ] **Step 1: Tests qui échouent** — `normalizeCode('  Maison-Nantes-Centre ')` =
  `maison-nantes-centre` ; `normalizeCode('maison nantes')` = `maison-nantes` (Review Focus 3).
  `ApiClient` avec `HttpTestingController` : en-tête `X-Device-Id` présent ; `409` → `ApiError`
  status 409 ; `photoUrl` contient `?d=`.
- [ ] **Step 2: Vérifier l'échec** — `ng test` → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add api client and device identity`

### Task 15: État local et réducteur

**Files:**
- Create: `src/app/core/reducer.ts`, `src/app/core/reducer.spec.ts`
- Create: `src/app/core/local-store.ts`, `src/app/core/local-store.spec.ts`

**Interfaces:**
- Produces:
  - `applyOp(state: VisitState, op: Op): VisitState` — fonction pure, même effet que le
    serveur pour l'affichage : `set_shared` met `author = state.me.number`, `updated_at =
    op.client_ts` ; `add_room` sans section → pièce `room` avec un point note « Note globale de
    la pièce » ; `add_room` avec section → pièce vide (le serveur la remplit, la synchro
    rapporte les points) ; `dir_name` provisoire `''`.
  - `mergeChanges(state: VisitState, changes: VisitState): VisitState` — remplace `visit`,
    `me`, `seq`, et fusionne chaque liste par clé (`id` ; `(target_id, field)` ; `point_id` ;
    `room_id`).
  - `class LocalStore` (Dexie, base `visite`) : tables `meta`, `visits` (clé `code` :
    `{code, state: VisitState}`), `outbox` (clé `op_id`, index `code`, champ `op`),
    `photos` (clé `id`, index `code` : `{id, code, room_id, taken_at, blob}`).
    Méthodes : `saveState(code, state)`, `getState(code)`, `listVisits()`,
    `enqueue(code, op)`, `pendingOps(code): Promise<Op[]>` (ordre d'insertion),
    `ackOps(opIds: string[])`, `addPhoto(rec)`, `pendingPhotos(code)`, `ackPhoto(id)`,
    `removeVisit(code)` (refuse avec une erreur `PendingDataError` si `outbox` ou `photos` non
    vide pour ce code).

- [ ] **Step 1: Tests qui échouent** :
  `applyOp` pour chaque type (une assertion par type) ; `mergeChanges` remplace une valeur
  partagée existante et ajoute une nouvelle pièce ; `LocalStore.removeVisit` refuse s'il reste
  une opération ; `pendingOps` rend l'ordre d'insertion.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add local store and op reducer`

### Task 16: Service de synchronisation

**Files:**
- Create: `src/app/core/sync.service.ts`, `src/app/core/sync.service.spec.ts`

**Interfaces:**
- Consumes: `ApiClient`, `LocalStore`, `applyOp`, `mergeChanges`.
- Produces: `SyncService` (injectable) :
  - `open(code): Promise<void>` (charge l'état local dans le signal, démarre la boucle) et
    `close()` ;
  - `state: Signal<VisitState | null>` ;
  - `status: Signal<{ online: boolean; pendingOps: number; pendingPhotos: number; error: string | null }>` ;
  - `dispatch(type: OpType, payload: object): Promise<void>` (crée l'`Op` avec
    `crypto.randomUUID()` et `Date.now()`, `applyOp`, sauvegarde, `enqueue`, puis `kick()`) ;
  - `addPhoto(roomId: string | null, blob: Blob): Promise<void>` ;
  - `kick(): void` ;
  - `rejected$: Observable<OpResult>` (pour les messages à l'utilisateur).

Algorithme d'un cycle (`kick`, événement `online`, retour au premier plan, minuterie) :
1. Envoyer les opérations en attente par lots de 500 ; retirer celles qui ont un résultat.
   Si au moins un `rejected` : émettre sur `rejected$`, recharger `state()` complet, réappliquer
   les opérations encore en attente.
2. Puis envoyer les photos une par une ; `409` ou `404` ⇒ retirer la photo de la file et
   émettre un message ; autre erreur ⇒ garder.
3. Puis `changes(since = seq)`, `mergeChanges`, réappliquer les opérations en attente,
   sauvegarder.
4. Erreur réseau ou `5xx` à n'importe quelle étape : arrêter le cycle, replanifier avec le délai
   suivant (1, 2, 4, 8, 16, 30 s), remis à 1 s après un cycle réussi.
5. Récupération périodique : toutes les 5 s si `navigator.onLine` et
   `document.visibilityState === 'visible'`. Un seul cycle à la fois.

- [ ] **Step 1: Tests qui échouent** (faux `ApiClient`, `fake-indexeddb`, minuteries simulées
  de Vitest) :
  `dispatch` met à jour `state()` immédiatement et `pendingOps` = 1 ; après un cycle réussi
  `pendingOps` = 0 ; envoi en échec réseau → l'opération reste, nouvel essai à 1 s puis 2 s ;
  `rejected` → `rejected$` émet et `state()` est rechargé ; les photos partent après les
  opérations (ordre des appels du faux client) ; photo `409` retirée ; une valeur locale en
  attente n'est pas écrasée par un `changes` plus ancien (réapplication).
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add offline sync service`

### Task 17: Calculs et compression d'image

**Files:**
- Create: `src/app/core/compute.ts`, `src/app/core/compute.spec.ts`
- Create: `src/app/core/image.ts`, `src/app/core/image.spec.ts`

**Interfaces:**
- Produces: `pricePerM2(f: Fiche): number | null` ; `notaryFees(price: number): number` ;
  `buildingAge(f: Fiche, year: number): number | null` ;
  `totalWorks(s: VisitState): number` (pièces visibles) ;
  `realPrice(s: VisitState): number | null` ; `weightedScore(s: VisitState): number | null`
  (mes notes, section `summary`) ; `blockingPoints(s: VisitState): Point[]` ;
  `unaskedCount(s: VisitState): number` ; `fitWithin(w, h, max = 2000): {width, height}` ;
  `compressImage(file: Blob): Promise<Blob>` (`createImageBitmap`, `canvas.toBlob('image/jpeg', 0.8)`).

- [ ] **Step 1: Tests qui échouent** — mêmes valeurs que la Task 2 (300000 → 22500 ; 2500 €/m² ;
  score 4.5) ; `fitWithin(4000, 3000)` = `2000×1500` ; `fitWithin(1000, 800)` inchangé ;
  `fitWithin(3000, 4000)` = `1500×2000` ; `totalWorks` ignore une pièce masquée.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter** (`compressImage` n'est testée qu'en bout en bout).
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add computed fields and image compression`

### Task 18: Accueil, création et inscription

**Files:**
- Create: `src/app/features/home/home.page.ts|html|scss|spec.ts`
- Create: `src/app/features/create/create.page.ts|html|scss|spec.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ApiClient`, `LocalStore`, `normalizeCode`, `CODE_RE`.
- Produces: routes `''` (accueil), `'new'` (création), `'v/:code'` (Task 19),
  `'v/:code/room/:roomId'` (Task 20), `'template'` (Task 22). Rejoindre = `join` + `state` +
  `saveState`, puis navigation vers `v/:code`.

Accueil : champ code (normalisé à la frappe) + bouton « Rejoindre », bouton « Créer une
visite », liste des visites locales (adresse, date) avec « Retirer » (message si des données
sont en attente), lien « Modèle ». Messages : `404` → « Aucune visite avec ce code », hors ligne
→ « Il faut du réseau pour rejoindre une visite ». Création : formulaire Material de tous les
champs de `Fiche` (DPE en listes A–G, `visit_at` en `datetime-local`), code vérifié par
`exists` après 300 ms sans frappe, adresse obligatoire.

- [ ] **Step 1: Tests qui échouent** (TestBed, `ApiClient` simulé) : rejoindre avec
  ` Maison-X ` appelle `join('maison-x')` ; `404` affiche le message ; la création est
  désactivée tant que l'adresse est vide ou le code pris.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add home and visit creation pages`

### Task 19: Vue d'ensemble de la visite

**Files:**
- Create: `src/app/features/visit/visit-shell.page.ts|html|scss|spec.ts`
- Create: `src/app/features/visit/sync-indicator.component.ts`
- Create: `src/app/features/visit/rooms-tab.component.ts|html|spec.ts`
- Create: `src/app/features/visit/add-room.dialog.ts`
- Create: `src/app/shared/photo-button.component.ts` (input `capture="environment"`, compresse,
  émet le `Blob` ; message « Stockage plein, photo non enregistrée » sur `QuotaExceededError`)

**Interfaces:**
- Consumes: `SyncService`, `compute.ts`, `compressImage`.
- Produces: `VisitShellPage` (appelle `sync.open(code)`, affiche en-tête + `SyncIndicator` +
  `mat-tab-nav-bar` vers les routes enfants `rooms` (défaut), `questions`, `fiche`, `bilan`) ;
  `PhotoButtonComponent` (`@Output() photo: EventEmitter<Blob>`), réutilisé par la Task 20.
  Les messages de `rejected$` s'affichent en `MatSnackBar`. Une visite clôturée affiche un
  bandeau « Visite clôturée » et toutes les saisies sont désactivées (`visit.closed_at`).

Indicateur : « Synchronisé » ou « N modifications et M photos en attente », icône hors ligne.
Onglet Pièces : liste « À emporter » repliable, pièces visibles triées par `position` avec
`points remplis / total` (un point est rempli s'il a ma note ou une valeur partagée `value`),
« Ajouter une pièce » (dialogue : nom + « vide » ou une section du modèle chargé via
`getTemplate`, hors ligne seulement « vide »), « Photo globale ».

- [ ] **Step 1: Tests qui échouent** : la progression `2 / 9` s'affiche pour une pièce avec deux
  points remplis ; le dialogue d'ajout appelle `dispatch('add_room', {id, name, from_section_id})` ;
  visite clôturée → bouton d'ajout désactivé.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add visit overview`

### Task 20: Écran d'une pièce

**Files:**
- Create: `src/app/features/room/room.page.ts|html|scss|spec.ts`
- Create: `src/app/features/room/point-card.component.ts|html|scss|spec.ts`
- Create: `src/app/features/room/point-menu.component.ts` (bloquant + travaux)

**Interfaces:**
- Consumes: `SyncService.dispatch`, `SyncService.addPhoto`, `PhotoButtonComponent`,
  `ApiClient.photoUrl`.
- Produces: `PointCardComponent` (`@Input() point`, `myRating`, `shared`, `disabled` ;
  `@Output() rate`, `@Output() setValue`), réutilisé par l'onglet Bilan (Task 21).

Contenu, dans l'ordre : nom de la pièce (renommable), surface mesurée (`area_m2`), cartes de
points (`note` : 5 boutons + N/A ; `case` : OK / Problème / N/A ; `constat` : pastilles +
N/A ; auteur « P2 » sous une valeur partagée ; icône rouge si bloquant), questions (case
« posée », champ réponse enregistré à la perte du focus), « Mon commentaire » (privé, enregistré
à la perte du focus), photos (vignettes : blob local si encore en file, sinon `photoUrl`),
« + point » / « + question », « Masquer la pièce » (confirmation), précédente / suivante parmi
les pièces visibles. Boutons d'au moins 48 px.

- [ ] **Step 1: Tests qui échouent** : un `note` affiche 6 boutons et un clic sur « 4 » émet
  `rate(4)` ; un `case` émet `setValue('problem')` ; la page appelle
  `dispatch('set_shared', {target_id, field: 'answer', value})` à la perte du focus ;
  « Suivante » mène à la pièce visible suivante.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add room page`

### Task 21: Onglets Questions, Fiche et Bilan

**Files:**
- Create: `src/app/features/visit/questions-tab.component.ts|html|spec.ts`
- Create: `src/app/features/visit/fiche-tab.component.ts|html|spec.ts`
- Create: `src/app/features/visit/summary-tab.component.ts|html|spec.ts`

**Interfaces:**
- Consumes: `SyncService`, `compute.ts`, `PointCardComponent`, `ApiClient.exportCsv`.

Questions : toutes les questions des pièces visibles groupées par pièce, filtre « Non posées »,
badge `unaskedCount` sur l'onglet (dans `VisitShellPage`). Fiche : champs, champs calculés
(prix au m², frais de notaire « ≈ 7,5 % », âge, prix réel), `tel:` / `mailto:` / lien de
l'annonce ; formulaire éditable seulement si `is_creator`, chaque champ modifié envoie
`set_fiche {fields: {champ: valeur}}`. Bilan : `PointCardComponent` pour les points de la
section `summary` (poids affiché), « Mon score : 4,2 / 5 », points bloquants (pièce + libellé),
total travaux, prix réel, alerte « N questions non posées », « Exporter le CSV » (blob →
téléchargement `<code>.csv`), « Copier pour Sheets » (`exportCsv(code, 'tab')` →
`navigator.clipboard.writeText`), « Clôturer » si `is_creator` (confirmation, `close_visit`).

- [ ] **Step 1: Tests qui échouent** : filtre « Non posées » ; formulaire de fiche désactivé si
  `is_creator` faux ; « Copier pour Sheets » appelle `exportCsv(code, 'tab')` puis le
  presse-papiers ; « Clôturer » absent pour un non-créateur.
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add questions, fiche and summary tabs`

### Task 22: Éditeur du modèle

**Files:**
- Create: `src/app/features/template/template.page.ts|html|scss|spec.ts`

**Interfaces:**
- Consumes: `ApiClient.getTemplate`, `ApiClient.putTemplate`.

Liste des sections (nom, kind, réordonnables par `cdkDrag`), et dans chacune les points (libellé,
type, options en puces pour `constat`, poids si `summary`) et les questions ; ajout et suppression ;
« À emporter » en zone de texte ; « Enregistrer ». Nouveaux éléments : `crypto.randomUUID()`.
`409` → message « Le modèle a été modifié ailleurs », rechargement. `400` → message. Hors
ligne → page désactivée avec « Il faut du réseau pour modifier le modèle ».

- [ ] **Step 1: Tests qui échouent** : enregistrer envoie la `version` chargée ; `409` recharge
  et affiche le message ; ajouter un `constat` sans option désactive « Enregistrer ».
- [ ] **Step 2: Vérifier l'échec** → FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vérifier** — PASS.
- [ ] **Step 5: Commit** — `feat: add template editor`

---

## Partie 3 — Bout en bout et livraison

### Task 23: Tests Playwright

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/visit.spec.ts`,
  `frontend/e2e/fixtures/photo.jpg` (petite image JPEG)
- Modify: `taskfile.yml` (tâche `e2e` : `task build`, puis `npx playwright test`)

`webServer` de Playwright : le binaire construit, `VISITE_SERVER_PORT=8099`,
`VISITE_DB_PATH` et `VISITE_PHOTOS_DIR` dans un dossier temporaire neuf. Projet Chromium en
émulation `Pixel 7`.

- [ ] **Step 1: Écrire les tests** (deux `browser.newContext()` = A et B) :
  - `notes are hidden between participants` : A crée `e2e-<timestamp>`, B rejoint ; A note
    « Luminosité » de la Cuisine 5, B la note 2 ; chacun ne voit que sa note ; l'export CSV
    contient `5` et `2` sur la ligne Luminosité.
  - `shared answer propagates` : A répond à une question ; B voit la réponse et « P1 » en
    moins de 10 s.
  - `offline edits sync on reconnect` : `contextB.setOffline(true)`, B coche un point et répond
    à une question, l'indicateur affiche « 2 modifications … en attente » ;
    `setOffline(false)` → « Synchronisé », et A voit les valeurs.
  - `offline photo uploads later` : B hors ligne ajoute `photo.jpg` dans la Cuisine, revient en
    ligne ; le fichier existe sous `<photos>/<code>/cuisine/` et finit par `.jpg`.
  - `closed visit is read-only` : A clôture ; B voit le bandeau et les boutons désactivés.
- [ ] **Step 2: Lancer** — `task e2e` → les 5 tests passent. Corriger le code (pas les tests)
  en cas d'échec, en revenant à la tâche concernée.
- [ ] **Step 3: Commit** — `test: add end-to-end scenarios`

### Task 24: Image Docker et documentation

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`
- Modify: `taskfile.yml` (tâche `docker:build`)

`Dockerfile` en trois étapes : `docker.io/library/node:24.16.0-alpine` (build Angular),
`docker.io/library/golang:1.26.4-alpine` (copie du build dans `backend/web/dist`, `CGO_ENABLED=0`,
`GOOS=$TARGETOS GOARCH=$TARGETARCH`, ldflags `buildinfo`), `docker.io/library/alpine` avec version
précise (binaire seul, utilisateur non root, `EXPOSE 8080`, `VOLUME /data`,
`VISITE_DB_PATH=/data/visite.db`, `VISITE_PHOTOS_DIR=/data/photos`,
`HEALTHCHECK … wget -qO- http://localhost:8080/version`). Les étapes de build utilisent
`--platform=$BUILDPLATFORM`. `README.md` (en français) : rôle, variables, `task` disponibles,
construction de l'image, emplacement des photos.

- [ ] **Step 1: Construire** — `docker buildx build --platform linux/amd64,linux/arm64 -t visite:dev .`
  → succès pour les deux architectures.
- [ ] **Step 2: Vérifier** — `docker run --rm -p 8099:8080 -v "$(mktemp -d)":/data visite:dev`
  (amd64, chargé avec `--load`), puis `curl -s localhost:8099/version` répond et
  `curl -s localhost:8099/` renvoie le HTML de l'app ; le conteneur passe `healthy`.
- [ ] **Step 3: Vérifier la définition de « terminé »** — `go build ./...`, `go vet ./...`,
  `go test ./...`, `ng test`, `npx ng build`, `task e2e` → tout passe.
- [ ] **Step 4: Commit** — `build: add docker image and readme`

Le déploiement (fichier compose dans `orchestrator`, port dans `ports.env`, volume dans
`/mnt/docker-data`, exposition Traefik publique) est hors de ce plan : le propriétaire s'en
charge, et toute variable ou exception d'exposition se décide avec lui.
