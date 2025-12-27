
package api

import (
	"net/http"

	"github.com/gorilla/mux"
)

var (
	// router defines http router for http service.
	router = mux.NewRouter()
	// v1Router defines router with api v1 prefix.
	v1Router = router.PathPrefix("/v1").Subrouter()
)

// GetRouter returns global server routes.
func GetRouter() *mux.Router {
	return router
}

// GetV1Router returns server route with /v1 prefix.
func GetV1Router() *mux.Router {
	return v1Router
}

func init() {
	GetRouter().HandleFunc("/", func(rw http.ResponseWriter, r *http.Request) {
		sendResponse(http.StatusOK, true, nil, nil, rw)
	}).Methods("GET")
}
