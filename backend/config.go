package main

// Config contient la configuration lue depuis les variables d'environnement.
type Config struct {
	ServerPort int    `key:"VISITE_SERVER_PORT" default-value:"8080"`
	DBPath     string `key:"VISITE_DB_PATH" default-value:"./visite.db"`
	PhotosDir  string `key:"VISITE_PHOTOS_DIR" default-value:"./photos"`
}
