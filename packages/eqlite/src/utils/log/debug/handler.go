
package debug

import (
	"encoding/json"
	"net/http"

	"eqlite/src/utils/log"
)

func init() {
	http.HandleFunc("/debug/eqlite/loglevel",
		func(w http.ResponseWriter, req *http.Request) {
			data := map[string]interface{}{}
			switch req.Method {
			case http.MethodPost:
				level := req.FormValue("level")
				data["orig"] = log.GetLevel().String()
				if level != "" {
					data["want"] = level
					lvl, err := log.ParseLevel(level)
					if err != nil {
						data["err"] = err.Error()
					} else {
						// set level
						log.SetLevel(lvl)
					}
				}
				fallthrough
			case http.MethodGet:
				data["level"] = log.GetLevel().String()
				_ = json.NewEncoder(w).Encode(data)
			default:
				w.WriteHeader(http.StatusBadRequest)
			}
		},
	)
}
