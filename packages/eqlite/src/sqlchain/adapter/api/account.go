
package api

import (
	"net/http"

	"eqlite/src/utils/log"
)

func init() {
	var api accountAPI
	GetV1Router().HandleFunc("/balance/info", api.BalanceInfo).Methods("GET")
}

type accountAPI struct{}

// BalanceInfo returns information about how to check token balances.
func (a *accountAPI) BalanceInfo(rw http.ResponseWriter, r *http.Request) {
	log.Debug("balance info request")
	sendResponse(http.StatusOK, true, nil, map[string]interface{}{
		"message": "Token balances are managed by the EQLiteRegistry smart contract.",
	}, rw)
}
