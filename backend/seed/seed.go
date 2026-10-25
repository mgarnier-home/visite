// Package seed fournit le modèle de visite initial, tiré de la checklist.
package seed

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/mgarnier-home/visite/model"
)

//go:embed template.json
var templateJSON []byte

// Template renvoie le modèle initial embarqué dans le binaire.
func Template() (model.Template, error) {
	var t model.Template
	if err := json.Unmarshal(templateJSON, &t); err != nil {
		return model.Template{}, fmt.Errorf("lecture de la seed : %w", err)
	}
	return t, nil
}
