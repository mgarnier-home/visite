-- Éléments importants : affichés par défaut dans leur pièce, les autres sont secondaires (masqués
-- tant qu'ils sont vides). Les points et questions d'une visite copient l'indicateur du modèle.
-- Par défaut 1 : un élément ajouté pendant la visite, ou antérieur à cette migration, est important.
ALTER TABLE template_points ADD COLUMN important INTEGER NOT NULL DEFAULT 1;
ALTER TABLE visit_points ADD COLUMN important INTEGER NOT NULL DEFAULT 1;
ALTER TABLE visit_questions ADD COLUMN important INTEGER NOT NULL DEFAULT 1;
