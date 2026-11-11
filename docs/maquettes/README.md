# Maquettes de la v2.0.0

Canevas éditable : https://claude.ai/artifact/HMTcP2PP8vePzWvM9WEQmG. Les sources des écrans sont
dans `sources/` (format du canevas, non autonome : elles ne s'ouvrent pas seules dans un
navigateur). Spec : `../superpowers/specs/2026-11-11-v2-annonces-design.md`.

| N° | Fichier           | Écran                                                                    |
| -- | ----------------- | ------------------------------------------------------------------------ |
| 1  | `Main.dc.html`    | Accueil sur téléphone : sections par statut, écartées repliées           |
| 2  | `Ajout.dc.html`   | Ajouter : coller le texte partagé, lien repéré                           |
| 3  | `Apercu.dc.html`  | Vérifier les infos récupérées ; réglage `site` pour la saisie manuelle   |
| 4  | `Annonce.dc.html` | Onglet Annonce (Annonce \| Pièces \| Questions \| Bilan) ; réglage `statut` |
| 5  | `Bureau.dc.html`  | Accueil sur ordinateur : une colonne par statut                          |

Décisions prises sur ces maquettes (2026-11-11) :

- présentation de l'accueil : liste par statut sur téléphone, colonnes sur ordinateur ;
- la visite est créée avec l'annonce et s'ouvre par les onglets de l'annonce, sans bouton
  « Commencer la visite » ;
- l'écran 3 en mode `leboncoin` montre la saisie manuelle, qui sert pour tout lien non reconnu :
  Leboncoin n'est pas récupéré automatiquement en 2.0.0 ;
- les photos sont des emplacements ; les adresses, prix et textes sont inventés.
