-- Modèle global
CREATE TABLE template (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    version      INTEGER NOT NULL DEFAULT 0,
    packing_list TEXT NOT NULL DEFAULT ''
);
INSERT INTO template (id, version, packing_list) VALUES (1, 0, '');

CREATE TABLE template_sections (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    position INTEGER NOT NULL
);

CREATE TABLE template_points (
    id         TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    type       TEXT NOT NULL,
    options    TEXT NOT NULL DEFAULT '[]', -- liste JSON
    weight     REAL NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL,
    important  INTEGER NOT NULL DEFAULT 1 -- affiché par défaut ; sinon secondaire
);

CREATE TABLE template_questions (
    id         TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    important  INTEGER NOT NULL DEFAULT 0 -- repris dans « Autres questions » ; indicateur d'affichage
);

-- Annonces suivies ; dates en RFC 3339 (TEXT), features en liste JSON, raw : réponse brute du site.
CREATE TABLE listings (
    id                TEXT PRIMARY KEY,
    source            TEXT NOT NULL,
    url               TEXT NOT NULL UNIQUE,
    status            TEXT NOT NULL DEFAULT 'contact',
    created_at        TEXT NOT NULL,
    mail_sent_at      TEXT,
    visit_at          TEXT,
    visited_at        TEXT,
    fetched_at        TEXT,
    removed_at        TEXT,
    fetch_error       TEXT NOT NULL DEFAULT '',
    title             TEXT NOT NULL DEFAULT '',
    property_type     TEXT NOT NULL DEFAULT '',
    price_eur         REAL,
    rooms             INTEGER,
    bedrooms          INTEGER,
    bathrooms         INTEGER,
    shower_rooms      INTEGER,
    toilets           INTEGER,
    parking           INTEGER,
    floor             INTEGER,
    construction_year INTEGER,
    living_area_m2    REAL,
    land_area_m2      REAL,
    dpe               TEXT NOT NULL DEFAULT '',
    ges               TEXT NOT NULL DEFAULT '',
    heating           TEXT NOT NULL DEFAULT '',
    city              TEXT NOT NULL DEFAULT '',
    postal_code       TEXT NOT NULL DEFAULT '',
    address           TEXT NOT NULL DEFAULT '',
    description       TEXT NOT NULL DEFAULT '',
    agency            TEXT NOT NULL DEFAULT '',
    agent_phone       TEXT NOT NULL DEFAULT '',
    agent_email       TEXT NOT NULL DEFAULT '',
    features          TEXT NOT NULL DEFAULT '[]',
    notes             TEXT NOT NULL DEFAULT '',
    raw               TEXT NOT NULL DEFAULT ''
);

CREATE TABLE listing_photos (
    id         TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    path       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    UNIQUE (listing_id, source_url)
);

-- Visites : code contient l'id de l'annonce. seq : compteur de la visite.
CREATE TABLE visits (
    code         TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    packing_list TEXT NOT NULL DEFAULT '',
    seq_changed  INTEGER NOT NULL DEFAULT 0,
    seq          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE visit_rooms (
    id         TEXT PRIMARY KEY,
    visit_code TEXT NOT NULL REFERENCES visits(code) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    dir_name   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    hidden     INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (visit_code, dir_name)
);
CREATE INDEX visit_rooms_visit ON visit_rooms(visit_code, seq);

CREATE TABLE visit_points (
    id       TEXT PRIMARY KEY,
    room_id  TEXT NOT NULL REFERENCES visit_rooms(id) ON DELETE CASCADE,
    label    TEXT NOT NULL,
    type     TEXT NOT NULL,
    options  TEXT NOT NULL DEFAULT '[]', -- liste JSON
    weight   REAL NOT NULL DEFAULT 1,
    position INTEGER NOT NULL,
    important INTEGER NOT NULL DEFAULT 1,
    seq      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX visit_points_room ON visit_points(room_id);

CREATE TABLE visit_questions (
    id       TEXT PRIMARY KEY,
    room_id  TEXT NOT NULL REFERENCES visit_rooms(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    position INTEGER NOT NULL,
    important INTEGER NOT NULL DEFAULT 1,
    seq      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX visit_questions_room ON visit_questions(room_id);

CREATE TABLE participants (
    visit_code TEXT NOT NULL REFERENCES visits(code) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    number     INTEGER NOT NULL,
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (visit_code, device_id),
    UNIQUE (visit_code, number)
);

-- Valeurs individuelles ; updated_at en millisecondes Unix.
CREATE TABLE ratings (
    point_id   TEXT NOT NULL REFERENCES visit_points(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    value      INTEGER CHECK (value IS NULL OR value BETWEEN 1 AND 5),
    updated_at INTEGER NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (point_id, device_id)
);

CREATE TABLE room_comments (
    room_id    TEXT NOT NULL REFERENCES visit_rooms(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    text       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, device_id)
);

-- Valeurs partagées ; value en JSON. target_id sans clé étrangère (point, question ou pièce).
CREATE TABLE shared_values (
    target_id  TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    device_id  TEXT NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (target_id, field)
);

CREATE TABLE photos (
    id         TEXT PRIMARY KEY,
    visit_code TEXT NOT NULL REFERENCES visits(code) ON DELETE CASCADE,
    room_id    TEXT REFERENCES visit_rooms(id),
    device_id  TEXT NOT NULL,
    taken_at   TEXT NOT NULL,
    path       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX photos_visit ON photos(visit_code, seq);

-- Journal des opérations et garde-fou contre les doublons.
CREATE TABLE ops (
    op_id       TEXT PRIMARY KEY,
    visit_code  TEXT NOT NULL REFERENCES visits(code) ON DELETE CASCADE,
    device_id   TEXT NOT NULL,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    client_ts   INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    result      TEXT NOT NULL
);
