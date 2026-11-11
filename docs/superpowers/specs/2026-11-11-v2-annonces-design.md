# Visite 2.0 — suivi des annonces

Date : 2026-11-11
Statut : validée le 2026-11-11
Remplace, pour ce qu'il traite, la spec v1 (`2026-10-25-visite-maison-design.md`) et les retours
n° 1 (`2026-10-25-retours-1-design.md`). Version : 2.0.0, sans compatibilité avec la 0.0.x.
Maquettes : `docs/maquettes/` (canevas : https://claude.ai/artifact/HMTcP2PP8vePzWvM9WEQmG).

## 1. Objectif

L'application ne sert plus seulement à mener une visite : elle suit toutes les annonces
repérées sur Bien'ici, Jinka et Leboncoin, de « à contacter » jusqu'à « visite effectuée ». On
colle le texte que le site génère avec « Partager » ; l'application retrouve le lien, récupère les
caractéristiques et les photos, et les garde sur le serveur. La visite de la v1 (pièces, notes,
photos, questions, bilan) devient une partie de la fiche de l'annonce.

### Critères de réussite

- Coller un texte partagé depuis Bien'ici ou Jinka crée l'annonce avec ses caractéristiques et
  ses photos, sans rien saisir.
- La page d'accueil montre, pour chaque annonce, sa photo, son prix, ses caractéristiques
  principales et son statut.
- Les photos s'affichent sans contacter le site d'origine.
- Une visite se mène comme en v1 depuis l'onglet Pièces de l'annonce, à plusieurs téléphones, et
  reste modifiable après coup.
- Un appel `POST /api/listings/refresh` met à jour toutes les annonces suivies.

## 2. Décisions

- Pas d'authentification ni de propriétaire : toute personne qui accède au serveur ajoute,
  modifie et supprime les annonces et les visites.
- Statuts : **À contacter**, **Mail envoyé**, **Visite planifiée**, **Visite effectuée**,
  **Écartée**. On passe librement de l'un à l'autre, dans les deux sens.
- Une seule visite par annonce, créée en même temps que l'annonce à partir du modèle.
- Plus de code de visite, plus de page « Rejoindre » ni « Créer », plus de créateur, plus de
  clôture : la visite est toujours modifiable.
- La fiche du bien de la v1 disparaît : l'annonce en tient lieu (onglet Annonce).
- Plus de mode hors ligne : ni base locale (Dexie / IndexedDB), ni file de modifications en
  attente, ni service worker. L'application suppose le réseau disponible. Le manifeste PWA reste,
  pour l'installation sur l'écran d'accueil.
- Le protocole serveur de la visite (opérations idempotentes, « dernière écriture gagnante »,
  lecture des changements depuis `seq`) est conservé : il gère déjà l'écriture simultanée de
  plusieurs téléphones. Les notes et commentaires individuels restent masqués aux autres
  participants ; un téléphone reste un participant (P1, P2…), identifié par son `device_id`.
- Récupération automatique pour Bien'ici et Jinka. Leboncoin est hors périmètre : il bloque tout
  client qui n'est pas un navigateur, et le contourner est exclu. Un lien Leboncoin (ou de tout
  autre site) crée une annonce en saisie manuelle.
- Rafraîchir n'est jamais automatique dans l'application : un bouton par annonce et une route
  d'API pour toutes ; le propriétaire planifie lui-même l'appel.
- Base vidée : le schéma repart d'une migration unique. Le propriétaire monte un volume dédié
  pour `/data` sur apollon.

## 3. Vocabulaire

| Terme    | Sens                                                              | Code        |
| -------- | ----------------------------------------------------------------- | ----------- |
| Annonce  | un bien repéré sur un site, avec son suivi                        | `listing`   |
| Source   | site d'origine : `bienici`, `jinka` ou `manual`                   | `source`    |
| Statut   | `contact`, `mail`, `planned`, `done`, `dropped`                   | `status`    |
| Visite   | les pièces, notes, photos et questions de la v1, liées à l'annonce | `visit`     |
| Rafraîchir | relire l'annonce sur son site et mettre à jour ses données      | `refresh`   |

## 4. Données

Le schéma est réécrit en une seule migration `001_init.sql` ; les migrations `001` à `003` de
la v1 sont supprimées. Au démarrage, une base qui contient la migration `003_important.sql`
(base v1) est refusée avec un message explicite : il faut repartir d'un dossier de données vide.

### Annonce (`listings`)

| Colonne                                   | Type    | Rôle                                              |
| ----------------------------------------- | ------- | ------------------------------------------------- |
| `id`                                      | TEXT    | identifiant aléatoire (UUID)                      |
| `source`                                  | TEXT    | `bienici`, `jinka`, `manual`                      |
| `url`                                     | TEXT    | lien d'origine nettoyé, **unique**                |
| `status`                                  | TEXT    | statut, `contact` par défaut                      |
| `created_at`                              | TEXT    | RFC 3339                                          |
| `mail_sent_at`, `visit_at`, `visited_at`  | TEXT    | dates de suivi, nulles tant que l'étape n'est pas atteinte |
| `fetched_at`                              | TEXT    | dernière récupération réussie                     |
| `removed_at`                              | TEXT    | le site ne trouve plus l'annonce                  |
| `fetch_error`                             | TEXT    | dernier échec de récupération, vide sinon         |
| `title`, `property_type`                  | TEXT    | « Maison 5 pièces 118 m² », « Maison »            |
| `price_eur`                               | REAL    |                                                   |
| `rooms`, `bedrooms`, `bathrooms`, `shower_rooms`, `toilets`, `parking`, `floor`, `construction_year` | INTEGER | nuls si non indiqués |
| `living_area_m2`, `land_area_m2`          | REAL    |                                                   |
| `dpe`, `ges`, `heating`                   | TEXT    |                                                   |
| `city`, `postal_code`, `address`          | TEXT    | `address` saisi à la main, le site le donne rarement |
| `description`                             | TEXT    | texte de l'annonce (tronqué chez Jinka)           |
| `agency`, `agent_phone`, `agent_email`    | TEXT    |                                                   |
| `features`                                | TEXT    | liste JSON : `garden`, `terrace`, `balcony`, `pool`, `cellar`, `fireplace`, `elevator`, `garage`… |
| `notes`                                   | TEXT    | notes libres partagées                            |
| `raw`                                     | TEXT    | réponse brute du site (JSON), pour exploiter plus tard un champ non repris |

Le lien est « nettoyé » avant stockage et comparaison : schéma `https`, sans paramètres de
requête ni fragment (`?alert_id=…&utm_source=…` des liens Jinka).

### Photos d'annonce (`listing_photos`)

`id`, `listing_id` (cascade), `position`, `source_url` (unique par annonce), `path`, `size`.
Fichiers sous `VISITE_PHOTOS_DIR/listings/<listing_id>/`, supprimés avec l'annonce.

### Visite

Les tables de la v1 sont conservées, avec ces changements :

- `visits` : la clé `code` garde son nom (et `visit_code` dans les autres tables) mais contient
  l'id de l'annonce, avec une référence `listings(id)` en cascade ; les colonnes de la fiche
  (`address` … `heating_type`, `fiche_ts`), `creator_device_id` et `closed_at` disparaissent.
- Supprimer une annonce supprime aussi les lignes de sa visite sans clé étrangère
  (`shared_values`).
- Opérations supprimées : `set_fiche`, `close_visit`, et les refus `closed` / `forbidden`. Les
  notes libres de la visite (`set_shared` sur la visite elle-même) disparaissent : ce sont les
  notes de l'annonce. Les notes libres par pièce restent.
- L'exclusion de pièces à la création disparaît (la visite est créée sans écran) : on masque les
  pièces inutiles depuis l'onglet Pièces, comme en v1.
- L'identifiant d'appareil passe d'IndexedDB à `localStorage`.

## 5. Récupération des annonces

Paquet Go `scrape`, sans dépendance à la base :

```go
type Result struct { Listing model.ListingData; PhotoURLs []string; Raw json.RawMessage }
func FindURL(text string) (source, url string, ok bool) // premier lien https du texte
func Fetch(ctx context.Context, source, url string) (Result, error)
var ErrRemoved = errors.New("annonce retirée")
```

- **Repérage** : le premier `https://…` du texte. Hôte `bienici.com` → `bienici`, `jinka.fr`
  → `jinka`, autre hôte → `manual`. Aucun lien → erreur « aucun lien dans ce texte ».
- **Bien'ici** : l'identifiant est le dernier segment du chemin de l'annonce ; appel de
  `https://www.bienici.com/realEstateAd.json?id=<id>`. Correspondance des champs : `price`,
  `propertyType`, `roomsQuantity`, `bedroomsQuantity`, `bathroomsQuantity`,
  `showerRoomsQuantity`, `toiletQuantity`, `surfaceArea`, `landSurfaceArea`,
  `parkingPlacesQuantity`, `floor`, `yearOfConstruction` (0 → nul), `energyClassification`,
  `greenhouseGazClassification`, `heating`, `city`, `postalCode`, `description`, `title`, les
  booléens `has*` et quantités (`terracesQuantity`…) vers `features`, `photos[].url`.
- **Jinka** : lecture de la page publique `https://www.jinka.fr/ad/<uuid>` ; les données sont
  dans la charge utile React Server Components de la page (`area`, `room`, `bedroom`,
  `land_area`, `floor`, `dpe`, `ges`, `garden`, `parking`, `city`, `postal_code`, `description`,
  `images`, prix). Le titre de la page sert de repli pour le prix et le titre. La description y
  est tronquée.
- HTTP : `User-Agent: visite/<version>`, délai de 20 s par requête, aucun contournement de
  protection. Réponse 404 ou 410 → `ErrRemoved`. Format inattendu (aucun champ reconnu, prix
  absent) → erreur explicite, jamais d'annonce à moitié remplie en silence.
- **Photos** : téléchargées par le serveur à partir des seules URL renvoyées par `Fetch`
  (jamais une URL envoyée par le client) : `https` uniquement, type `image/*`, 15 Mo au plus,
  stockées telles quelles. Une photo en échec est ignorée et journalisée ; les autres sont
  gardées.
- **Rafraîchir** une annonce : nouveau `Fetch` ; les caractéristiques et `raw` sont remplacées
  (une correction manuelle est écrasée), les nouvelles photos ajoutées à la suite, les anciennes
  gardées. Le statut, les dates de suivi, `address` et `notes` ne changent jamais.
  `ErrRemoved` → `removed_at` renseigné ; autre erreur → `fetch_error` renseigné, données
  conservées. Une annonce `manual` n'est pas rafraîchie.
- **Tout rafraîchir** : les annonces non écartées et non manuelles, une par une, avec 1 s
  d'attente entre deux, pour ménager les sites.

## 6. API

Toutes les réponses sont en JSON, sauf les images et le CSV.

| Méthode et route                                  | Rôle |
| ------------------------------------------------- | ---- |
| `GET /api/listings`                               | liste : champs principaux, statut, dates, id de la première photo |
| `POST /api/listings` `{text}`                      | repère le lien, récupère, enregistre, télécharge les photos, crée la visite ; `201` + annonce. `409 {id}` si le lien est déjà suivi, `422` si aucun lien, `502` si le site répond mal (rien n'est créé) |
| `GET /api/listings/{id}`                          | annonce complète, avec la liste des photos |
| `PATCH /api/listings/{id}`                        | modifie les champs envoyés (caractéristiques, statut, dates, adresse, notes) |
| `DELETE /api/listings/{id}`                       | supprime l'annonce, sa visite et leurs photos |
| `POST /api/listings/{id}/refresh`                 | rafraîchit une annonce ; renvoie l'annonce |
| `POST /api/listings/refresh`                      | rafraîchit tout ; renvoie `{updated, removed, failed: [{id, error}]}` |
| `GET /api/listings/{id}/photos/{photoId}`         | image d'annonce |
| `GET /api/listings/{id}/visit`                    | état de la visite (`?since=` pour les changements) |
| `POST /api/listings/{id}/visit/join`              | inscrit l'appareil comme participant |
| `POST /api/listings/{id}/visit/ops`               | applique des opérations |
| `POST /api/listings/{id}/visit/photos`, `GET …/visit/photos/{photoId}` | photos de visite, comme en v1 |
| `GET /api/listings/{id}/visit/export.csv`         | export CSV ; les lignes « Fiche » viennent de l'annonce |
| `GET`/`PUT /api/template`                         | inchangées |

Changement de statut par `PATCH` : passer à `mail` renseigne `mail_sent_at` (maintenant) s'il
est nul ; passer à `planned` demande `visit_at` ; passer à `done` renseigne `visited_at`
(maintenant) s'il est nul. Revenir en arrière ne vide aucune date.

## 7. Écrans

| Route                          | Écran (maquette)                                                            |
| ------------------------------ | --------------------------------------------------------------------------- |
| `/`                            | Accueil : sections par statut sur téléphone (1), colonnes sur ordinateur à partir de 1024 px (5) ; écartées repliées ; bouton « Ajouter une annonce » |
| `/annonces/nouvelle`           | Coller le texte partagé (2) ; « Récupérer l'annonce » appelle `POST /api/listings` |
| `/annonces/:id/verifier`       | Vérifier les infos et choisir le statut de départ (3) ; « Annuler » supprime l'annonce |
| `/annonces/:id`                | Onglets **Annonce** (4) \| **Pièces** \| **Questions** \| **Bilan** |
| `/annonces/:id/piece/:roomId`  | Pièce, comme en v1                                                          |
| `/modele`                      | Modèle de visite, inchangé                                                  |

- Onglet Annonce : photos (défilement), prix et prix au m², frise des 4 étapes avec leurs dates,
  bloc d'action selon le statut (« Mail envoyé », « Planifier la visite » avec date et heure,
  « Visite effectuée », « Voir le bilan »), caractéristiques, contact, notes, lien d'origine,
  dates d'ajout et de récupération, « Rafraîchir », « Écarter », « Supprimer » (avec
  confirmation). Bandeau si l'annonce est retirée ou si la dernière récupération a échoué.
- Saisie manuelle (lien non reconnu) : l'écran Vérifier s'ouvre avec les champs vides et le
  titre repris du texte collé, sans photo.
- L'onglet Fiche disparaît ; la date de visite est celle de l'annonce (`visit_at`) et le Bilan
  prend le prix de l'annonce pour les frais de notaire.
- Une écriture qui échoue affiche un message et recharge l'état de la visite.

## 8. Ce qui disparaît

- Back : `set_fiche`, `close_visit`, droits du créateur, routes `/api/visits/*`,
  `exists`, champs de fiche dans `model`, migrations v1.
- Front : pages Accueil (code) et Création, `code.ts`, `code-typing.ts`, onglet Fiche,
  `db.ts`, `local-store.ts`, `background-sync.service.ts`, la file d'attente de
  `sync.service.ts`, le service worker (`ngsw-config.json`, `provideServiceWorker`), les
  dépendances `dexie` et `fake-indexeddb`.

## 9. Tests

- Go : `FindURL` (textes partagés réels de Bien'ici, Jinka, Leboncoin, sans lien) ; `Fetch` sur
  des réponses enregistrées dans `scrape/testdata` (une annonce Bien'ici, une page Jinka) servies
  par `httptest` ; règles de statut et de rafraîchissement dans le store ; routes `listings` avec
  un faux récupérateur ; opérations de visite existantes adaptées (sans fiche ni clôture).
- Front : tests unitaires des nouvelles pages (accueil groupé par statut, ajout, vérification,
  onglet Annonce) et adaptation des tests de visite ; suite lancée aussi avec `TZ=UTC`.
- E2E Playwright : ajout d'une annonce par lien non reconnu (saisie manuelle, aucun appel
  externe), changement de statut, visite à deux participants, suppression.
- Hors CI : un essai manuel sur une vraie annonce Bien'ici et une vraie annonce Jinka avant la
  PR.

## 10. Hors périmètre

- Leboncoin automatique (pistes notées : bouton dans le navigateur, ou partage depuis Jinka).
- Ajout ou suppression manuelle de photos d’annonce (retiré des maquettes).
- Plusieurs visites par annonce.
- Rafraîchissement planifié dans l'application, alertes de baisse de prix.
- Volume de données sur apollon (le propriétaire s'en charge dans orchestrator).
