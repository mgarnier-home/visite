# Visite

Application web installable sur l'écran d'accueil (PWA, mais qui exige le réseau) pour préparer, mener et comparer des visites de maisons à l'achat. Un
backend Go sert l'API et embarque l'application Angular ; les données sont stockées dans une base
SQLite et un répertoire de photos.

## Fonctionnalités

- Suivi des annonces : on colle le texte partagé depuis Bien'ici ou Jinka (bouton « Partager »),
  l'application retrouve le lien, récupère les caractéristiques et copie les photos sur le serveur.
  Les statuts vont de « À contacter » à « Visite effectuée », ou « Écartée », dans les deux sens.
- Sites pris en charge : Bien'ici et Jinka (récupération automatique). Leboncoin bloque les clients
  qui ne sont pas des navigateurs : un lien Leboncoin (ou d'un autre site) crée une annonce en
  saisie manuelle.
- Une annonce a une seule visite, toujours modifiable, que plusieurs participants mènent depuis
  leur téléphone (P1, P2…, un par appareil) : pas de compte, pas de code.
- Modèle de visite par pièces : notes de 1 à 5, constats, cases à cocher, commentaires et
  questions à poser, avec pièces ajoutables ou masquables.
- Valeurs partagées entre participants (blocage, coût des travaux, surfaces, réponses, notes
  libres par pièce) ; les notes individuelles restent masquées aux autres.
- Photos JPEG (2000 px au plus, 10 Mo maximum) rattachées à une pièce.
- Bilan : score pondéré sur 5 (N/A exclus), frais de notaire à 7,5 % du prix, export CSV.
- Pas de mode hors ligne : l'application suppose le réseau disponible.
- Une base de la v1 est refusée au démarrage : il faut repartir d'un dossier de données vide.

## Rafraîchir les annonces

Rien n'est rafraîchi automatiquement. Le bouton « Rafraîchir » d'une annonce relit son site
(`POST /api/listings/{id}/refresh`) ; pour toutes les annonces suivies, appelez la route suivante,
par exemple depuis un cron (comptez environ une seconde par annonce) :

```sh
curl -X POST http://localhost:8080/api/listings/refresh
```

La réponse est un rapport (annonces mises à jour, retirées du site ou en échec).

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
avec un utilisateur non root, `visite`, d'uid et de gid fixes `10001`. Les arguments `VERSION`,
`COMMIT` et `DATE` renseignent `/version`. Les images de base sont épinglées par version et par
empreinte. Le contrôle de santé interroge `/version` sur le port `VISITE_SERVER_PORT` (8080 par
défaut).

Essai local, avec un volume nommé (initialisé par l'image, donc déjà à l'uid 10001) :

```sh
docker run --rm -p 8099:8080 -v visite-data:/data visite:dev
```

Avec un dossier de l'hôte, celui-ci doit être accessible en écriture par l'uid 10001 :

```sh
mkdir -p data && sudo chown 10001:10001 data
docker run --rm -p 8099:8080 -v "$PWD/data":/data visite:dev
```

## Emplacement des données

Tout est sous `/data` dans le conteneur :

- `/data/visite.db` : base SQLite (avec ses fichiers `-wal` et `-shm`) ;
- `/data/photos/<id de l'annonce>/<pièce>/…` : photos, nommées `AAAAMMJJ-HHMMSS-<8 hex>.jpg`.

## Synchronisation entre participants

Chaque modification est envoyée au serveur sous forme d'opérations idempotentes (dernière écriture
gagnante). Au premier plan, l'application récupère les changements des autres participants toutes
les 5 secondes.

## Déploiement

Le déploiement est assuré par le propriétaire : fichier compose dans le dépôt `orchestrator`,
port déclaré dans `ports.env`, volume sous `/mnt/docker-data`. L'exposition publique via Traefik
reste à décider.
