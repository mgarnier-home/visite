# Visite — application de visite de maison

Date : 2026-10-25
Statut : design validé, en attente de relecture de la spec

## 1. Objectif

Pendant une visite de maison, deux ou trois personnes (le propriétaire du projet, sa partenaire,
de la famille) parcourent la maison pièce par pièce sur leur téléphone. Chacune note les points
de chaque pièce sans voir les notes des autres, l'équipe partage les constats et les réponses de
l'agent immobilier, et un rappel liste les questions à poser avant de partir. À la fin, un export
CSV par visite se colle dans Google Sheets pour comparer les maisons.

Le contenu de départ (pièces, points à vérifier, questions) vient de
`checklist-visite-maison.md`. Le modèle évolue ensuite au fil des visites.

### Critères de réussite

- Créer une visite avec sa fiche du bien et la rejoindre depuis un autre téléphone avec son code.
- Noter, cocher, répondre et prendre des photos sans réseau, puis tout retrouver sur le serveur
  au retour du réseau, sans perte ni doublon.
- Aucun participant ne voit, dans l'application, les notes ni les commentaires d'un autre.
- Un export CSV par visite, lisible dans Google Sheets et Excel.

## 2. Vocabulaire

| Terme       | Sens                                                                         | Code       |
| ----------- | ---------------------------------------------------------------------------- | ---------- |
| Visite      | une maison visitée, identifiée par un code choisi (`maison-nantes-centre`)   | `visit`    |
| Pièce       | une section d'une visite : pièce de la maison ou thème (Extérieur, Quartier) | `room`     |
| Point       | un élément à évaluer dans une pièce                                          | `point`    |
| Question    | une question à poser à l'agent ou au vendeur, rattachée à une pièce          | `question` |
| Modèle      | la liste globale des sections, points et questions, copiée à chaque création | `template` |
| Participant | un appareil inscrit à une visite (un appareil = un participant)              | `participant` |
| Créateur    | l'appareil qui a créé la visite                                              | —          |

## 3. Décisions

- Accès public, le code de la visite est la seule clé. Pas de compte, pas de mot de passe, pas
  de prénom.
- Un participant est un appareil, identifié par un `device_id` anonyme, numéroté P1, P2… dans
  l'ordre d'arrivée. Le créateur est P1. Changer d'appareil ou vider ses données fait perdre son
  identité, et le droit de créateur avec.
- Notes (`note`) et commentaires de pièce : individuels et masqués. Le serveur ne les renvoie
  jamais à un autre appareil. Ils n'apparaissent que dans l'export CSV, libre d'accès : le
  masquage sert à ne pas s'influencer, pas à protéger un secret.
- Constats (`constat`, `case`), drapeaux bloquants, estimations de travaux, réponses de l'agent,
  case « posée » et notes libres (une par pièce, une pour la visite) : partagés entre
  participants, dernière écriture gagnante. Tous les participants modifient les notes libres,
  y compris celles de la visite.
- Seul le créateur modifie la fiche du bien et clôture la visite. Une visite clôturée refuse
  toute nouvelle saisie ; elle reste consultable et exportable.
- Créer et rejoindre une visite demandent le réseau. Tout le reste fonctionne hors ligne.
- Le modèle se modifie dans l'application. Chaque visite en garde une copie faite à sa création :
  modifier le modèle ne change pas les visites existantes.
- Cibles : Android, Chrome et Firefox, application installée en PWA.
- Back en Go avec SQLite, front en Angular avec Angular Material, photos dans un dossier local
  monté en volume. L'hébergement et l'exposition sont gérés par le propriétaire, hors de cette
  spec.

## 4. Architecture

```
visite/
├── backend/          module Go github.com/mgarnier-home/visite
│   ├── main.go
│   ├── api/          handlers HTTP (gorilla/mux)
│   ├── ops/          validation et application des opérations
│   ├── store/        accès SQLite, migrations
│   ├── export/       génération du CSV
│   ├── photos/       stockage des fichiers (interface PhotoStore)
│   ├── seed/         modèle initial (template.json, embarqué)
│   └── web/          build Angular embarqué (embed.FS), copié avant `go build`
├── frontend/         application Angular
├── docs/
├── Dockerfile
└── taskfile.yml
```

- Un seul binaire sert l'API sous `/api/*`, `/version`, et l'application Angular (toute autre
  route renvoie `index.html`). Une image, un port, pas de CORS.
- Image Docker multi-arch (`linux/amd64`, `linux/arm64`), construite en plusieurs étapes : build
  Angular, build Go, image finale Alpine avec `wget` pour le healthcheck sur `/version`.
- Dépendances Go alignées sur les autres repos : `gorilla/mux`, `github.com/mgarnier-home/utils`
  (`config`, `logger`, `buildinfo`, `version`). SQLite via `modernc.org/sqlite` (Go pur, sans
  CGO).
- Le schéma SQLite est versionné par des migrations SQL numérotées, appliquées au démarrage.
- Au premier démarrage, si le modèle est vide, il est rempli depuis `seed/template.json`. Ce
  fichier est écrit à la main à partir de la checklist (annexe A) ; la checklist Markdown n'est
  pas lue par l'application.

### Configuration

Variables d'environnement lues par `utils/config` :

| Variable              | Rôle                               | Défaut          |
| --------------------- | ---------------------------------- | --------------- |
| `VISITE_SERVER_PORT`  | port HTTP                          | `8080`          |
| `VISITE_DB_PATH`      | chemin du fichier SQLite           | `./visite.db`   |
| `VISITE_PHOTOS_DIR`   | racine du stockage des photos      | `./photos`      |

Aucun secret. Les variables propres au déploiement (port publié, volume) seront proposées au
moment du déploiement et ajoutées à `/mnt/secrets` seulement avec l'accord du propriétaire.

## 5. Modèle de données

### 5.1 Modèle global

- `template` : une ligne. `version` (entier, incrémenté à chaque modification), `packing_list`
  (texte « À emporter », affiché sur la vue d'ensemble d'une visite).
- `template_sections` : `id`, `name`, `kind`, `position`.
  - `room` : une pièce, instanciée une fois ;
  - `per_bedroom` : une pièce instanciée N fois (« Chambre 1 » … « Chambre N »), N étant le
    nombre de chambres de la fiche ;
  - `topic` : un thème sans pièce physique (Questions générales), instancié une fois ;
  - `summary` : le bilan, instancié une fois.
- `template_points` : `id`, `section_id`, `label`, `type` (`note`, `constat`, `case`),
  `options` (liste JSON, obligatoire et non vide pour `constat`, vide sinon), `weight` (réel,
  utilisé seulement dans la section `summary`, défaut 1), `position`.
- `template_questions` : `id`, `section_id`, `text`, `position`.

Une section `per_bedroom` n'a pas de questions : elles seraient répétées pour chaque chambre. Les
questions sur les chambres de la checklist vont dans « Questions générales » (annexe A).

### 5.2 Une visite

- `visits` : `code` (clé), `creator_device_id`, `created_at`, `closed_at` (nul si ouverte), et
  la fiche du bien, tous les champs facultatifs sauf l'adresse :
  `address`, `price_eur`, `living_area_m2`, `floor_area_m2`, `land_area_m2`, `visit_at`,
  `agent_name`, `agent_phone`, `agent_email`, `construction_year`, `dpe_energy` (A à G),
  `dpe_ges` (A à G), `rooms_count`, `bedrooms_count`, `listing_url`, `heating_type`.
- `visit_rooms` : `id` (UUID), `visit_code`, `name`, `dir_name`, `kind`, `position`, `hidden`.
- `visit_points` : `id` (UUID), `room_id`, `label`, `type`, `options`, `weight`, `position`.
- `visit_questions` : `id` (UUID), `room_id`, `text`, `position`.
- `participants` : `visit_code`, `device_id`, `number`, `joined_at`.

À la création, le serveur copie le modèle dans `visit_rooms`, `visit_points` et
`visit_questions`, et ajoute à chaque pièce de type `room` ou `per_bedroom` un point
`note` « Note globale de la pièce » en tête. Les sections `topic` et `summary` n'en reçoivent
pas.

Les identifiants des pièces, points et questions sont des UUID générés par le client, pour
pouvoir en ajouter hors ligne. Ceux créés par la copie du modèle sont générés par le serveur.

`dir_name` est un slug fixé à la création de la pièce (`cuisine`, `chambre-2`), unique dans la
visite (suffixe `-2`, `-3` en cas de doublon). Renommer une pièce ne le change pas. Masquer une
pièce (`hidden`) la retire de l'interface et de l'export ; ses données et ses photos restent.

### 5.3 Valeurs

Individuelles, jamais renvoyées à un autre appareil :

- `ratings` : `point_id`, `device_id`, `value` (1 à 5, ou nul pour N/A), `updated_at`, `seq`.
  Seuls les points `note` acceptent une note.
- `room_comments` : `room_id`, `device_id`, `text`, `updated_at`, `seq`.

Partagées :

- `shared_values` : `target_id`, `field`, `value` (JSON), `updated_at`, `device_id`, `seq`.
  Clé (`target_id`, `field`). Champs autorisés :

| Cible    | Champ       | Valeur                                                      |
| -------- | ----------- | ----------------------------------------------------------- |
| point    | `value`     | `case` : `ok`, `problem`, `na` ; `constat` : une des options ou `na` |
| point    | `blocking`  | booléen (tout type de point)                                |
| point    | `works_eur` | entier positif ou nul (tout type de point)                  |
| question | `answer`    | texte                                                       |
| question | `asked`     | booléen                                                     |
| pièce    | `area_m2`   | réel positif ou nul (surface mesurée)                       |
| pièce    | `notes`     | texte libre                                                 |
| visite   | `notes`     | texte libre ; `target_id` = code de la visite               |

Un élément ajouté (pièce, point, question) ne peut pas prendre le code de la visite comme id.

Autres tables :

- `photos` : `id` (UUID client), `visit_code`, `room_id` (nul pour une photo globale),
  `device_id`, `taken_at`, `path` (relatif à `VISITE_PHOTOS_DIR`), `size`, `seq`.
- `ops` : `op_id` (clé), `visit_code`, `device_id`, `type`, `payload`, `client_ts`,
  `received_at`, `result`. Journal et garde-fou contre les doublons.
- `visit_seq` : compteur par visite, incrémenté à chaque modification appliquée. Chaque ligne
  modifiée prend la nouvelle valeur dans sa colonne `seq`.

### 5.4 Champs calculés

Calculés par le front, non stockés, affichés sur la fiche et le bilan, présents dans l'export :

- prix au m² = `price_eur / living_area_m2` ;
- frais de notaire estimés = 7,5 % du prix (ancien) ;
- âge du bâtiment = année courante − `construction_year` ;
- total des travaux = somme des `works_eur` des pièces visibles ;
- prix réel = prix + frais de notaire + total des travaux ;
- score pondéré d'un participant = Σ(note × poids) / Σ(poids) sur les points de la section
  `summary` qu'il a notés (N/A exclus), arrondi au dixième, sur 5.

## 6. Stockage des photos

```
<VISITE_PHOTOS_DIR>/
└── maison-nantes-centre/
    ├── 20261025-143012-a1b2c3d4.jpg      photo globale
    ├── cuisine/
    │   └── 20261025-143520-e5f6a7b8.jpg
    └── chambre-2/
        └── 20261025-144801-c9d0e1f2.jpg
```

- Nom de fichier : date de prise (`AAAAMMJJ-HHMMSS`, heure locale du téléphone) suivie des
  8 premiers caractères hexadécimaux de l'UUID de la photo.
- Le chemin est construit par le serveur à partir du code de la visite et du `dir_name` stocké,
  jamais à partir d'un chemin fourni par le client.
- Interface `PhotoStore` (`Put`, `Open`) avec une seule implémentation, le système de fichiers.
- JPEG uniquement (vérifié sur les premiers octets), 10 Mo au maximum.

## 7. API

Chaque requête porte l'en-tête `X-Device-Id` (UUID). Corps et réponses en JSON sauf mention.

| Méthode et route                          | Rôle                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/visits/{code}/exists`           | `200 {exists: bool}`, pour vérifier un code pendant la saisie        |
| `POST /api/visits`                        | crée la visite (code et fiche). `409` si le code existe, `400` si invalide |
| `POST /api/visits/{code}/join`            | inscrit l'appareil (idempotent), renvoie son numéro. `404` si inconnue |
| `GET /api/visits/{code}`                  | état complet filtré pour l'appareil, avec `seq` courant              |
| `POST /api/visits/{code}/ops`             | lot d'opérations, résultat par opération                             |
| `GET /api/visits/{code}/changes?since=N`  | lignes dont `seq > N`, filtrées pour l'appareil, et `seq` courant    |
| `POST /api/visits/{code}/photos`          | multipart : `id`, `room_id` (facultatif), `taken_at`, `file`        |
| `GET /api/visits/{code}/photos/{id}`      | le fichier JPEG                                                      |
| `GET /api/visits/{code}/export.csv`       | l'export CSV (section 9)                                             |
| `GET /api/template`                       | le modèle complet avec sa `version`                                  |
| `PUT /api/template`                       | remplace le modèle. `409` si la `version` envoyée n'est pas la courante |
| `GET /version`                            | version (`utils/version`), sert de healthcheck                       |

Routes sous `/api/visits/{code}/…` (sauf `exists` et `join`) : `403` si l'appareil n'est pas
participant.

Code de visite : `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`.

Limites : 500 opérations et 1 Mo par lot, 10 Mo par photo.

### 7.1 Opérations

Format commun : `{op_id, type, client_ts, payload}`. `client_ts` est en millisecondes.

| Type           | Payload                                    | Qui           |
| -------------- | ------------------------------------------ | ------------- |
| `add_room`     | `id`, `name`, `from_section_id` (facultatif : copie les points et questions d'une section du modèle) | tous |
| `rename_room`  | `room_id`, `name`                          | tous          |
| `hide_room`    | `room_id`                                  | tous          |
| `add_point`    | `id`, `room_id`, `label`, `type`, `options` | tous         |
| `add_question` | `id`, `room_id`, `text`                    | tous          |
| `set_rating`   | `point_id`, `value`                        | tous (pour soi) |
| `set_comment`  | `room_id`, `text`                          | tous (pour soi) |
| `set_shared`   | `target_id`, `field`, `value`              | tous          |
| `set_fiche`    | champs modifiés de la fiche                | créateur      |
| `close_visit`  | —                                          | créateur      |

Règles d'application, dans cet ordre :

1. `op_id` déjà présent dans `ops` : résultat `duplicate`, rien n'est appliqué.
2. Visite clôturée, appareil non autorisé, cible inconnue, cible d'une autre visite ou valeur
   invalide : résultat `rejected` avec un motif (`closed`, `forbidden`, `not_found`, `invalid`).
3. Pour une valeur (`set_rating`, `set_comment`, `set_shared`, champ de `set_fiche`) : si la
   valeur stockée a un `updated_at` plus récent, l'opération est `applied` mais sans effet
   (dernière écriture gagnante). À horodatage égal, le plus grand `device_id` l'emporte. La
   valeur stockée reçoit alors un nouveau `seq` (`seq_changed` pour la fiche) : `changes` la
   renvoie à l'expéditeur, qui affichait encore sa propre valeur.
4. Sinon la modification est écrite, `visit_seq` est incrémenté, résultat `applied`.

Un lot est traité opération par opération dans une transaction par opération : une opération
refusée n'empêche pas les suivantes.

## 8. Front

### 8.1 Organisation

- Angular récent (composants standalone, signals), Angular Material, PWA via
  `@angular/service-worker` (coquille de l'application en cache).
- `LocalStore` (Dexie sur IndexedDB) : état des visites ouvertes sur l'appareil, file
  d'opérations, file de photos, `device_id`.
- `SyncService` : seul composant qui parle au réseau pour les visites. Les écrans lisent
  l'état local et appellent des actions ; une action écrit dans `LocalStore` puis dans la file.
- Seuls la création, l'inscription, l'écran Modèle et l'export CSV appellent l'API directement,
  puisqu'ils demandent le réseau. Les photos s'affichent depuis le blob local tant qu'il existe,
  sinon depuis `GET …/photos/{id}`.

### 8.2 Écrans

1. **Accueil** : rejoindre avec un code, créer une visite, liste des visites de l'appareil, lien
   vers le modèle.
2. **Création** : formulaire de la fiche, vérification du code pendant la saisie.
3. **Visite** : en-tête (adresse, indicateur de synchro : « synchronisé » ou « 3 modifications
   et 2 photos en attente »), liste « À emporter », onglets :
   - **Pièces** : liste avec progression (points remplis / total), boutons « Ajouter une
     pièce » (vide ou copie d'une section du modèle) et « Photo globale » ;
   - **Questions** : toutes les questions par pièce, filtre « non posées », badge du nombre de
     questions non posées ;
   - **Fiche** : lecture seule sauf pour le créateur, notes de la visite en tête, modifiables par tous,
     champs calculés, téléphone et e-mail de l'agent cliquables ;
   - **Bilan** : mes notes des critères pondérés, mon score pondéré, points bloquants, total
     des travaux, prix réel, alerte sur les questions non posées, boutons « Exporter le CSV »,
     « Copier pour Sheets » et, pour le créateur, « Clôturer ».
4. **Pièce** : notes partagées en tête, surface mesurée, points (une carte par type : 5 boutons et N/A pour `note` ;
   OK / Problème / N/A pour `case` ; pastilles d'options et N/A pour `constat`), menu « ⋯ »
   par point pour le drapeau bloquant et les travaux, auteur affiché sur les valeurs partagées
   (« P2 »), questions avec case « posée » et réponse, mon commentaire, photos (vignettes et
   bouton appareil photo), ajout d'un point ou d'une question, navigation précédente / suivante.
5. **Modèle** : édition des sections, points (type, options, poids) et questions, réordonnancement,
   enregistrement avec gestion du `409`.

Une visite clôturée s'affiche en lecture seule.

### 8.3 Synchronisation

- Inscription : `join` puis `GET /api/visits/{code}`, état stocké dans `LocalStore`.
- Envoi de la file d'opérations : après chaque action, à l'événement `online`, au retour au
  premier plan, et après un échec avec un délai croissant (1 s, 2 s, 4 s… jusqu'à 30 s). Une
  opération quitte la file quand le serveur a répondu `applied`, `duplicate` ou `rejected`.
- Récupération : `changes?since=<seq local>` toutes les 5 secondes quand l'application est au
  premier plan et en ligne.
- Photos : file séparée, envoyée après la file d'opérations (la pièce doit exister côté
  serveur). Une photo reste en blob dans IndexedDB jusqu'à son envoi réussi.
- Opération refusée : message à l'utilisateur, puis rechargement de l'état complet.

### 8.4 Photos

- Bouton appareil photo : `<input type="file" accept="image/*" capture="environment">`.
- Compression dans le navigateur avant stockage local : redimensionnement à 2000 px au plus sur
  le grand côté, JPEG qualité 0,8, via un `canvas`.
- `taken_at` = heure de prise sur le téléphone.

## 9. Export CSV

- Séparateur `;`, UTF-8 avec BOM, une ligne d'en-tête.
- Colonnes : `visite;pièce;point;type;réponse partagée;posée;P1;…;Pn;bloquant;travaux €`, où n
  est le nombre de participants de la visite.
- La colonne `visite` contient le code sur chaque ligne.
- Lignes, dans l'ordre :
  1. Fiche : `pièce` = « Fiche », `point` = nom du champ, valeur dans `réponse partagée`, notes
     de la visite (`notes`) et champs calculés compris.
  2. Pour chaque pièce visible, dans l'ordre : sa surface mesurée (`type` = `surface`), ses
     points (`type` = `note`, `constat` ou `case` ; valeur partagée ou notes par participant),
     ses questions (`type` = `question`), une ligne `notes` avec ses notes partagées, puis une
     ligne `commentaire` avec le commentaire de chaque participant.
  3. Bilan : ses points avec le poids dans `réponse partagée`, une ligne `score pondéré` avec le
     score de chaque participant, une ligne `total travaux`, une ligne `prix réel`.
- N/A s'écrit `N/A`, une valeur absente reste vide, les booléens s'écrivent `oui` ou vide.
- « Copier pour Sheets » copie le même contenu séparé par des tabulations, sans BOM, dans le
  presse-papiers.

## 10. Erreurs et robustesse

- Erreurs réseau et `5xx` : nouvelle tentative avec délai croissant, rien n'est perdu.
- Stockage local plein à l'ajout d'une photo : message explicite, la photo n'est pas enregistrée
  et l'utilisateur le sait.
- Une visite ne peut être retirée de la liste de l'appareil que si ses files sont vides.
- Validation côté serveur de tout ce qui vient du client (codes, slugs, valeurs, tailles).

## 11. Tests

Écrits avant l'implémentation.

- Go :
  - `ops` (table-driven) : dernière écriture gagnante, égalité d'horodatage, doublons, refus
    (`closed`, `forbidden`, `not_found`, `invalid`) ;
  - `store` (SQLite temporaire) : copie du modèle, chambres générées, note globale ajoutée,
    `dir_name` uniques, filtrage des notes et commentaires des autres, curseur `seq` ;
  - `export` : comparaison à un fichier de référence ;
  - `photos` (dossier temporaire) : arborescence, nom de fichier, refus des non-JPEG ;
  - `api` (`httptest`) : codes de retour, `403` pour un non-participant, `409` du modèle.
- Angular (lanceur de tests par défaut) : `SyncService` (file, délai croissant, rechargement
  après refus), compression d'image, champs calculés, score pondéré.
- Bout en bout (Playwright) : deux contextes de navigateur ; notes masquées entre eux ;
  réponse partagée propagée ; saisie hors ligne (`setOffline`) synchronisée au retour du réseau ;
  photo prise hors ligne envoyée ensuite.

Terminé quand passent : `go build ./...`, `go vet ./...`, `go test ./...`, `ng test`,
`ng build`, Playwright.

## 12. Hors périmètre de la v1

Notés pour plus tard : vue comparative entre maisons dans l'application, export global depuis
la base, mot de passe de visite, prénom des participants, carte des maisons visitées, seconde
visite liée à la première, notes vocales.

## Annexe A — modèle initial

Repris de `checklist-visite-maison.md`. Types : **N** = `note`, **C** = `case`, **K** =
`constat` (options entre parenthèses). Chaque section `room` et `per_bedroom` reçoit aussi le
point « Note globale de la pièce » (N), non listé ici.

**À emporter** (`packing_list`) : mètre ou appli laser, lampe torche, téléphone chargé, chargeur
ou testeur de prises, bille ou appli niveau.

### Questions générales (`topic`)

Points : aucun. Questions :

- Pourquoi vendez-vous ? Depuis quand la maison est-elle en vente ?
- Depuis combien de temps habitez-vous ici ?
- Le prix est-il négociable ? Y a-t-il déjà eu des offres ?
- Quelle est la date de libération possible ?
- Qu'est-ce qui reste dans la maison (cuisine équipée, luminaires, placards, électroménager) ?
- Quels travaux ont été faits, quand, et par qui ? Avez-vous les factures et garanties (décennale) ?
- Y a-t-il des travaux à prévoir à court terme ?
- Y a-t-il déjà eu des dégâts des eaux, des infiltrations, des fissures ou des sinistres déclarés ?
- Quand la toiture, la chaudière et le chauffe-eau ont-ils été installés ou révisés ?
- Montant de la taxe foncière ?
- Factures annuelles d'énergie (électricité, gaz, fioul, bois) ?
- Tout-à-l'égout ou assainissement individuel (fosse) ? Dernier contrôle SPANC ?
- Lotissement ou copropriété ? Charges, règlement, ASL ?
- Le dossier de diagnostics est-il disponible (DPE, amiante, plomb, électricité, gaz, termites, état des risques) ?
- Y a-t-il des servitudes, un droit de passage, des projets de construction à proximité ?
- Quelle chambre est la plus chaude ou la plus froide ? *(venue de « Chambres »)*
- Les chambres à l'étage ont-elles leur propre salle d'eau ou toilettes ? *(venue de « Chambres »)*
- Les combles ou le grenier sont-ils aménageables en chambre supplémentaire ? *(venue de « Chambres »)*

### Extérieur et structure (`room`)

- C — Toiture : tuiles cassées ou déplacées, mousse, gouttières et descentes
- C — Façade : fissures (en escalier ou en diagonale), crépi qui s'effrite, humidité en bas des murs
- K — Vitrage (Simple, Double, Triple, Mixte)
- K — Volets (Manuels, Électriques, Mixtes, Aucun)
- C — Terrain : pente vers la maison, zones détrempées, clôtures et limites
- K — Orientation du jardin (N, NE, E, SE, S, SO, O, NO)
- N — Vis-à-vis (1 = fort, 5 = aucun)
- C — Stationnement et accès pour un véhicule

Questions : les 4 de la checklist (toiture, bornage, zone inondable ou argileuse, puits et
récupération d'eau).

### Entrée (`room`)

- C — Porte d'entrée : isolation, serrure multipoints, joints
- N — Rangements (placard, penderie)
- C — Tableau électrique : disjoncteurs récents, différentiel 30 mA, mise à la terre
- C — Compteurs (Linky, gaz, eau) et leur emplacement

Questions : les 3 de la checklist.

### Cuisine (`room`)

- C — Pression d'eau et temps d'arrivée de l'eau chaude
- C — Sous l'évier : fuites, humidité, moisissures
- N — État des meubles : portes, charnières, tiroirs, plan de travail
- C — Prises suffisantes au-dessus du plan de travail
- K — Hotte (Extraction extérieure, Recyclage, Absente)
- C — Ventilation (VMC, grille d'aération) et fenêtre
- C — Place pour lave-vaisselle, frigo américain, congélateur
- N — Luminosité

Questions : les 4 de la checklist.

### Salon / séjour (`room`)

- N — Volume : surface et hauteur sous plafond
- N — Luminosité
- C — Fenêtres : ouverture, joints, condensation entre les vitres
- C — Sol : grincements, carrelage fissuré ou creux, planité
- C — Murs et plafond : fissures, taches d'humidité, peinture fraîche suspecte
- C — Radiateurs : type, état, nombre suffisant
- C — Prises électriques, prise TV / RJ45
- K — Cheminée ou poêle (Cheminée ouverte, Insert, Poêle, Aucun)
- N — Bruit extérieur fenêtres fermées (1 = bruyant, 5 = silencieux)

Questions : les 4 de la checklist.

### Chambre (`per_bedroom`)

- K — Niveau (Rez-de-chaussée, Étage 1, Étage 2, Combles)
- K — Orientation (N, NE, E, SE, S, SO, O, NO)
- N — Surface et forme : lit double et passage, bureau
- N — Rangements : placard, penderie
- C — Fenêtres et volets : ouverture, joints, occultation
- C — Humidité : odeur, moisissures dans les angles
- C — Chauffage présent et prises suffisantes
- N — Bruit : rue, voisins, pièce d'à côté (1 = bruyant, 5 = silencieux)
- C — Sous combles : isolation, hauteur, chaleur l'été

La surface en m² du tableau comparatif de la checklist devient le champ partagé `area_m2` de la
pièce.

### Salle de bain (`room`)

- C — Pression et eau chaude avec douche et lavabo ouverts ensemble, écoulement
- C — Joints de baignoire ou de douche
- C — Carrelage : fissuré ou creux, surtout au sol de la douche
- C — Moisissures au plafond et dans les angles
- C — Ventilation : VMC qui aspire, fenêtre
- C — Sous le lavabo et derrière les meubles : fuites, bois gonflé
- C — Sèche-serviettes et prises loin des points d'eau
- C — Place pour lave-linge et sèche-linge

Questions : les 4 de la checklist.

### Toilettes (`room`)

- C — Chasse : remplissage, écoulement, bruit, odeur
- C — Pied de la cuvette : traces d'eau, sol abîmé
- C — Ventilation (VMC, fenêtre)
- K — Lave-mains (Oui, Non)
- K — Emplacement (Séparées à chaque niveau, Séparées, Dans la salle de bain)

Questions : les 2 de la checklist.

### Garage (`room`)

- N — Dimensions : voitures, largeur et hauteur de porte
- K — Porte de garage (Manuelle, Motorisée)
- C — Sol : fissures, taches d'huile, humidité
- C — Électricité : prises, éclairage, borne de recharge possible
- C — Point d'eau, évacuation
- K — Accès direct à la maison (Oui, Non)
- C — Charpente et plafond : insectes, humidité, plaques fibrociment
- N — Espace de stockage ou d'atelier

Questions : les 3 de la checklist.

### Combles, cave, buanderie, chaufferie (`room`)

- C — Combles : isolant, fuites sous toiture, charpente
- C — Cave ou sous-sol : humidité, salpêtre, traces d'inondation
- C — Chaudière ou pompe à chaleur : marque, âge, carnet d'entretien
- C — Ballon d'eau chaude : capacité, âge
- C — Buanderie : arrivée d'eau, évacuation, prise

Questions : les 4 de la checklist.

### Environnement et quartier (`room`)

- N — Réseau mobile dans la maison
- N — Bruit : route, voie ferrée, avions, école, bars (1 = bruyant, 5 = calme)
- N — Commerces, écoles, médecins, transports
- N — Trajet domicile-travail aux heures de pointe
- N — État des maisons voisines et de la rue
- C — Revenir à un autre moment (soir, week-end)

Questions : les 3 de la checklist.

### Bilan (`summary`)

| Point                   | Type | Poids |
| ----------------------- | ---- | ----- |
| Emplacement             | N    | 3     |
| Luminosité              | N    | 1     |
| Agencement des pièces   | N    | 2     |
| État général            | N    | 2     |
| Performance énergétique | N    | 1     |
| Extérieur / jardin      | N    | 1     |
| Coup de cœur            | N    | 2     |
| Prochaine étape         | K (Deuxième visite, Devis artisans, Offre, On passe) | — |

« Travaux à prévoir » et « Points bloquants » de la checklist sont calculés (total des
`works_eur`, liste des points `blocking`).
