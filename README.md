# Visite

Application web (PWA) pour préparer, mener et comparer des visites de maisons à l'achat. Un
backend Go sert l'API et embarque l'application Angular ; les données sont stockées dans une base
SQLite et un répertoire de photos.

## Fonctionnalités

- Une visite est identifiée par un code (`^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$`) que plusieurs
  participants peuvent rejoindre depuis leur téléphone.
- Fiche du bien (adresse, prix, surfaces, DPE, agent, etc.) et liste de choses à emporter.
- Modèle de visite par pièces : notes de 1 à 5, constats, cases à cocher, commentaires et
  questions à poser, avec pièces ajoutables ou masquables.
- Valeurs partagées entre participants (blocage, coût des travaux, surfaces, réponses).
- Photos JPEG (2000 px au plus, 10 Mo maximum) rattachées à une pièce.
- Synthèse : score pondéré sur 5 (N/A exclus), frais de notaire à 7,5 % du prix, export.
- Utilisable hors ligne.

## Variables d'environnement

| Variable             | Défaut         | Rôle                              |
| -------------------- | -------------- | --------------------------------- |
| `VISITE_SERVER_PORT` | `8080`         | Port d'écoute du serveur          |
| `VISITE_DB_PATH`     | `./visite.db`  | Chemin de la base SQLite          |
| `VISITE_PHOTOS_DIR`  | `./photos`     | Répertoire de stockage des photos |

Aucun secret n'est nécessaire. Dans l'image Docker, les deux chemins valent `/data/visite.db` et
`/data/photos`.

## Commandes `task`

| Commande            | Effet                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `task build:front`  | Construit l'application Angular et la copie dans `backend/web/dist`     |
| `task build:back`   | Compile le backend dans `bin/visite` (`VERSION`, `COMMIT`, `DATE`)      |
| `task build`        | Front puis back                                                         |
| `task run`          | Construit puis lance l'application avec les données dans `./data`       |
| `task test`         | Tests Go                                                                |
| `task front:dev`    | Serveur de développement Angular avec proxy vers le backend             |
| `task front:test`   | Tests unitaires Angular                                                 |
| `task e2e`          | Construit puis lance les scénarios Playwright                           |
| `task docker:build` | Construit l'image locale `visite:dev` (`linux/amd64`, builder `default`) |

Les versions d'outils sont fixées dans `.tool-versions` (Go 1.26.4, Node.js 24.16.0).

## Construire l'image Docker

```sh
task docker:build
# équivalent à :
docker buildx build --platform linux/amd64 --load -t visite:dev .
```

Le `Dockerfile` compile le front (Node), puis le binaire Go statique (`CGO_ENABLED=0`, compilation
croisée vers `linux/amd64` ou `linux/arm64`), et produit une image Alpine minimale qui s'exécute
avec un utilisateur non root. Les arguments `VERSION`, `COMMIT` et `DATE` renseignent
`/version`. Les images de base sont épinglées par version et par empreinte.

Essai local :

```sh
docker run --rm -p 8099:8080 -v "$(mktemp -d)":/data visite:dev
```

## Emplacement des données

Tout est sous `/data` dans le conteneur :

- `/data/visite.db` : base SQLite (avec ses fichiers `-wal` et `-shm`) ;
- `/data/photos/<code>/<pièce>/…` : photos, nommées `AAAAMMJJ-HHMMSS-<8 hex>.jpg`.

## Synchronisation hors ligne

Chaque modification est enregistrée localement puis envoyée au serveur sous forme d'opérations
idempotentes, regroupées par lots et rejouées avec un délai croissant (1, 2, 4, 8, 16 puis 30 s)
tant que le réseau manque. En ligne et au premier plan, l'application récupère les changements des
autres participants toutes les 5 secondes.

## Déploiement

Le déploiement est assuré par le propriétaire : fichier compose dans le dépôt `orchestrator`,
port déclaré dans `ports.env`, volume sous `/mnt/docker-data`. L'exposition publique via Traefik
reste à décider.
