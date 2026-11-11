// Package store persiste le modèle global et les visites dans SQLite.
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound        = errors.New("introuvable")
	ErrConflict        = errors.New("conflit")
	ErrVersionConflict = errors.New("version du modèle périmée")

	// ErrV1Database : la base porte la migration 003 de la v1, incompatible avec le schéma v2.
	ErrV1Database = errors.New("base de la version 1 : repartir d'un dossier de données vide")
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	db *sql.DB
}

// Open ouvre (ou crée) la base et applique les migrations manquantes.
// Les pragmas sont dans le DSN pour s'appliquer à chaque connexion du pool.
// _txlock=immediate : toute transaction prend le verrou d'écriture dès BEGIN, ce qui
// évite l'échec SQLITE_BUSY_SNAPSHOT d'une transaction qui passe de la lecture à l'écriture.
func Open(path string) (*Store, error) {
	dsn := "file:" + path +
		"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("ouverture de la base: %w", err)
	}
	s := &Store{db: db}
	if err := s.refuseV1(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// refuseV1 refuse une base dont schema_migrations contient une migration inconnue de la v2.
func (s *Store) refuseV1() error {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'schema_migrations'`).Scan(&n)
	if err != nil || n == 0 {
		return err
	}
	rows, err := s.db.Query(`SELECT name FROM schema_migrations`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		if _, err := migrationsFS.ReadFile("migrations/" + name); err != nil {
			return ErrV1Database
		}
	}
	return rows.Err()
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		return fmt.Errorf("table schema_migrations: %w", err)
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, name).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (name) VALUES (?)`, name); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
