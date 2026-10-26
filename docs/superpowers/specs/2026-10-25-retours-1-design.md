# Visite — retours n° 1

Date : 2026-10-25
Statut : en relecture
Complète : `2026-10-25-visite-maison-design.md` (la « spec v1 »). Ce document l'emporte sur elle
pour les points qu'il traite.

## 1. Objet

Retours du propriétaire après la première utilisation :

- la saisie de la date de visite ne suit pas le format français ;
- les champs numériques acceptent des caractères qui ne sont pas des chiffres ;
- Questions générales affiche « 0 / 0 » dans la liste des pièces ;
- toutes les pièces du modèle sont créées alors qu'une maison n'a pas toujours de garage, de cave
  ou d'entrée ;
- plusieurs questions du modèle sont à déplacer, reformuler ou supprimer.

## 2. Saisie de la date et de l'heure

Cause : `<input type="datetime-local">` suit la langue du navigateur, pas celle de la page ; un
navigateur en anglais attend mois puis jour.

- La création et l'onglet Fiche remplacent ce champ par deux champs :
  - **Date** : sélecteur de date Angular Material (`MatDatepicker`), adaptateur `date-fns`
    (`@angular/material-date-fns-adapter`) avec la locale `fr`, format de saisie et d'affichage
    `dd/MM/yyyy`, saisie au clavier ou par le calendrier ;
  - **Heure** : champ texte `HH:MM` sur 24 h (chiffres et `:` seulement, 00:00 à 23:59).
- Heure vide avec une date : l'instant est la date à 00:00. Date vide : `visit_at` est nul et
  l'heure est ignorée.
- La valeur envoyée reste un RFC 3339 avec le décalage local (`localIsoWithOffset`).

## 3. Champs numériques

- Tous les champs numériques deviennent `type="text"` avec une directive de filtrage partagée
  `appNumeric` (`src/app/shared/numeric.directive.ts`), en deux modes :
  - `integer` : chiffres seulement, `inputmode="numeric"` ;
  - `decimal` : chiffres et un seul séparateur (`,` ou `.`), au plus 2 décimales,
    `inputmode="decimal"`. La valeur envoyée utilise le point.
- Le filtre s'applique à la frappe et au collage. Aucun signe, aucune lettre, aucun `e`.
- Champs concernés :
  - `integer` : prix, nombre de pièces, nombre de chambres, année de construction (création et
    Fiche), travaux (€) ;
  - `decimal` : surfaces habitable, au sol et terrain (création et Fiche), surface mesurée d'une
    pièce, poids dans l'éditeur du modèle.
- Les règles existantes restent : vide = `null`, ≥ 0, poids > 0.

## 4. Compteur des sections sans points

Dans l'onglet Pièces, une section qui n'a aucun point (par exemple Questions générales ou Autres
questions) affiche « N / M posées » (questions marquées posées / total) au lieu de « remplis /
total ». Les autres pièces gardent le compteur de points.

## 5. Sélection des pièces à la création

### 5.1 Comportement

- L'écran de création affiche, sous la fiche, la liste « Pièces de la maison » : une case par
  section `room` du modèle, toutes cochées par défaut. Les sections `topic`, `per_bedroom` et
  `summary` ne sont pas proposées : Questions générales et Bilan sont toujours créés, les chambres
  suivent le nombre de chambres.
- Une section décochée n'est pas copiée : ni ses points, ni ses questions non importantes.
- Ses questions marquées **importantes** (§5.2) sont copiées dans une pièce **« Autres
  questions »** (kind `topic`, `dir_name` `autres-questions`), créée seulement si au moins une
  question importante est concernée. Chaque question y est préfixée par le nom de sa section
  d'origine : « Garage : La fibre est-elle raccordée ? ». « Autres questions » se place juste
  après Questions générales.
- « Ajouter une pièce » reste disponible pendant la visite (copie d'une section du modèle ou
  pièce vide), comme dans la spec v1.

### 5.2 Questions importantes

- `template_questions` gagne une colonne `important` (booléen, faux par défaut), et le contrat
  `TemplateQuestion` un champ `important: boolean`.
- L'éditeur du modèle affiche une case « Importante » pour chaque question d'une section `room`.
  Elle n'a pas d'effet pour les autres types de section, où elle est masquée.

### 5.3 API

- `CreateVisitRequest` gagne `excluded_section_ids: string[]` (facultatif, vide par défaut) :
  les identifiants des sections `room` décochées.
- Un identifiant inconnu, ou qui n'est pas une section `room`, donne `400`.
- L'écran de création charge le modèle avec `GET /api/template` (la création demande déjà le
  réseau).

## 6. Modèle initial : modifications

Ces modifications remplacent l'annexe A de la spec v1 pour les sections citées. Les sections non
citées sont inchangées. Les questions non marquées ✅ ne sont pas importantes.

### 6.1 Questions générales

- Supprimer « Les chambres à l'étage ont-elles leur propre salle d'eau ou toilettes ? ».
- Remplacer « Les combles ou le grenier sont-ils aménageables en chambre supplémentaire ? » par
  « Les combles ou le grenier sont-ils aménageables en chambre supplémentaire ? Si oui, quelle
  serait la hauteur sous plafond ? ».
- Ajouter « Y a-t-il un plancher chauffant ou une climatisation ? » (retirée du Salon).

### 6.2 Entrée

Section supprimée. Le point « Porte d'entrée : isolation, serrure multipoints, joints » (case)
va dans Extérieur et structure ; les points « Tableau électrique » et « Compteurs » et les trois
questions vont dans Garage ; le point « Rangements » est supprimé.

### 6.3 Questions par section

**Extérieur et structure** (+ point « Porte d'entrée » en dernière position)
- ✅ Quand la toiture a-t-elle été refaite ou démoussée ?
- ✅ Les limites du terrain sont-elles bornées ?
- ✅ Le terrain est-il en zone inondable ou argileuse (retrait-gonflement) ?
- Y a-t-il un puits, une récupération d'eau de pluie, un arrosage automatique ?

**Cuisine**
- ✅ La cuisine est-elle vendue équipée ? Quels appareils restent, et de quel âge ?
- ✅ Plaques au gaz ou à l'électricité ? Arrivée de gaz possible ?
- ✅ La cuisine a-t-elle été refaite ? Quand, et avez-vous les factures ?
- Peut-on ouvrir la cuisine sur le séjour (mur porteur ou non) ?

**Salon / séjour**
- ✅ Quel est le mode de chauffage principal ? Quel coût annuel ?
- La cheminée ou le poêle fonctionne-t-il ? Dernier ramonage (attestation) ?
- Quels murs sont porteurs ?

**Salle de bain**
- ✅ Quel est le système d'eau chaude (ballon, chaudière, thermodynamique) ? Capacité et âge ?
- ✅ La salle de bain a-t-elle été refaite ? Quand, et avez-vous les factures ?
- ✅ Y a-t-il déjà eu des fuites ou un dégât des eaux vers la pièce du dessous ?
- ✅ L'eau est-elle calcaire ? Y a-t-il un adoucisseur ?

**Toilettes**
- Y a-t-il une pompe de relevage ou un broyeur (sanibroyeur) ?
- ✅ Déjà eu des bouchons ou des remontées d'odeurs ?

**Garage** (+ points « Tableau électrique : disjoncteurs récents, différentiel 30 mA, mise à la
terre » et « Compteurs (Linky, gaz, eau) et leur emplacement », en tête après la note globale)
- ✅ L'installation électrique a-t-elle été refaite ? Quand ?
- ✅ Y a-t-il une alarme ou un visiophone ?
- ✅ La fibre est-elle raccordée ?
- Le garage est-il compté dans la surface habitable ? Peut-il être transformé en pièce ?
- Y a-t-il d'autres places de stationnement ?
- La chaudière, le ballon d'eau chaude ou le tableau électrique sont-ils ici ?

**Combles, cave, buanderie, chaufferie**
- ✅ La chaudière est-elle entretenue chaque année ? Peut-on voir la dernière attestation ?
- ✅ La cave a-t-elle déjà été inondée ?
- ✅ Les combles ont-ils été isolés ? Avec quoi et quand ?
- Y a-t-il des panneaux solaires ? Contrat de revente, production annuelle ?

**Environnement et quartier**
- ✅ Comment sont les voisins ? Y a-t-il des conflits de voisinage ?
- ✅ Des projets d'aménagement sont-ils prévus (route, lotissement, antenne) ? À vérifier au PLU
  en mairie
- ✅ Le quartier est-il calme la nuit ?

### 6.4 Bases existantes

Rien n'est en production. Le modèle n'étant appliqué qu'à une base vide, une base de
développement existante (`data/visite.db`) doit être supprimée pour recevoir le nouveau modèle.
Aucune migration du contenu du modèle n'est écrite ; la migration de schéma ajoute seulement la
colonne `important`.

## 7. Tests

- Back : migration (colonne `important`, défaut faux) ; `Template.Validate` inchangé ; création
  avec `excluded_section_ids` (section exclue absente, « Autres questions » créée avec les seules
  questions importantes préfixées et placée après Questions générales, absente si aucune question
  importante n'est concernée, `400` sur un identifiant inconnu ou non `room`) ; seed (Entrée
  absente, points déplacés, questions et drapeaux de §6).
- Front : directive `appNumeric` (frappe, collage, séparateur unique, 2 décimales) ; date et
  heure (saisie `25/10/2026` + `14:30` → RFC 3339 avec décalage ; heure vide → 00:00) ; compteur
  « posées » ; cases des pièces à la création (`excluded_section_ids` envoyé) ; case
  « Importante » dans l'éditeur.
- Bout en bout : le scénario de création existant reste vert ; ajouter une création avec Garage
  décoché vérifiant la présence de « Autres questions » et de « Garage : La fibre est-elle
  raccordée ? ».
