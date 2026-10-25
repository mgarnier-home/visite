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
    position   INTEGER NOT NULL
);

CREATE TABLE template_questions (
    id         TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    position   INTEGER NOT NULL
);

-- Visites ; created_at et closed_at en RFC 3339 (TEXT).
-- visit_seq : compteur de la visite. fiche_ts : JSON {champ: [updated_at, device_id]}.
-- seq_changed : seq de la dernière modification de la fiche ou de la clôture.
CREATE TABLE visits (
    code              TEXT PRIMARY KEY,
    creator_device_id TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    closed_at         TEXT,
    address           TEXT NOT NULL DEFAULT '',
    price_eur         REAL,
    living_area_m2    REAL,
    floor_area_m2     REAL,
    land_area_m2      REAL,
    visit_at          TEXT,
    agent_name        TEXT,
    agent_phone       TEXT,
    agent_email       TEXT,
    construction_year INTEGER,
    dpe_energy        TEXT,
    dpe_ges           TEXT,
    rooms_count       INTEGER,
    bedrooms_count    INTEGER,
    listing_url       TEXT,
    heating_type      TEXT,
    packing_list      TEXT NOT NULL DEFAULT '',
    fiche_ts          TEXT NOT NULL DEFAULT '{}',
    seq_changed       INTEGER NOT NULL DEFAULT 0,
    seq               INTEGER NOT NULL DEFAULT 0
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
    seq      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX visit_points_room ON visit_points(room_id);

CREATE TABLE visit_questions (
    id       TEXT PRIMARY KEY,
    room_id  TEXT NOT NULL REFERENCES visit_rooms(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    position INTEGER NOT NULL,
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
