
package api

import (
	"net/http"

	"eqlite/src/utils/log"
)

func init() {
	var api accountAPI

	// add routes
	// Note: Token balances are now managed by the EQLiteRegistry smart contract.
	// These endpoints return information about how to check balances on-chain.
	GetV1Router().HandleFunc("/balance/info", api.BalanceInfo).Methods("GET")
}

// accountAPI defines account features.
// Note: Token operations are now handled by the EQLiteRegistry smart contract.
type accountAPI struct{}

// BalanceInfo returns information about how to check token balances.
// Token balances are now managed on-chain via the EQLiteRegistry contract.
func (a *accountAPI) BalanceInfo(rw http.ResponseWriter, r *http.Request) {
	log.Debug("balance info request")
	sendResponse(http.StatusOK, true, nil, map[string]interface{}{
		"message": "Token balances are now managed by the EQLiteRegistry smart contract on Ethereum.",
		"info":    "Use the Jeju Network explorer or contract interface to check your JEJU token balance and staking status.",
	}, rw)
}
