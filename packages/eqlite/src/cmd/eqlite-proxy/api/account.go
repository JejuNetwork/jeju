
package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	gorp "gopkg.in/gorp.v2"

	"eqlite/src/cmd/eqlite-proxy/config"
	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/cmd/eqlite-proxy/utils"
)

func applyToken(c *gin.Context) {
	// Token faucet is deprecated - tokens are now managed by the EQLiteRegistry smart contract
	abortWithError(c, http.StatusGone, errors.New("token faucet is deprecated - use EQLiteRegistry contract on Ethereum"))
}

func showAllAccounts(c *gin.Context) {
	developer := getDeveloperID(c)
	d, err := model.GetDeveloper(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusForbidden, ErrInvalidDeveloper)
		return
	}

	accounts, err := model.GetAllAccounts(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrGetAccountFailed)
		return
	}

	var (
		apiResp = gin.H{}
		keys    []gin.H
	)

	for _, account := range accounts {
		keyData := gin.H{}

		addr, err := account.Account.Get()
		if err != nil {
			_ = c.Error(err)
			abortWithError(c, http.StatusBadRequest, ErrParseAccountFailed)
			return
		}

		if account.ID == d.MainAccount {
			apiResp["main"] = addr.String()
		}

		keyData["account"] = addr.String()
		// Note: Token balances are now managed by the EQLiteRegistry smart contract
		keyData["balance_info"] = "Check EQLiteRegistry contract on Ethereum for token balances"

		keys = append(keys, keyData)
	}

	apiResp["keypairs"] = keys

	responseWithData(c, http.StatusOK, apiResp)
}

func getBalance(c *gin.Context) {
	// Token balances are now managed by the EQLiteRegistry smart contract
	responseWithData(c, http.StatusOK, gin.H{
		"message": "Token balances are now managed by the EQLiteRegistry smart contract on Ethereum",
		"info":    "Use the Jeju Network explorer or contract interface to check your JEJU token balance and staking status",
	})
}

func setMainAccount(c *gin.Context) {
	r := struct {
		Account utils.AccountAddress `json:"account" form:"account" binding:"required,len=64"`
	}{}

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	developer := getDeveloperID(c)
	err := model.SetMainAccount(model.GetDB(c), developer, r.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSetMainAccountFailed)
		return
	}

	responseWithData(c, http.StatusOK, nil)
}

// ApplyTokenTask is deprecated - tokens are now managed by the EQLiteRegistry smart contract.
func ApplyTokenTask(ctx context.Context, cfg *config.Config, db *gorp.DbMap, t *model.Task) (r gin.H, err error) {
	args := struct {
		Amount uint64 `json:"amount"`
	}{}
	err = json.Unmarshal(t.RawArgs, &args)
	if err != nil {
		err = errors.Wrapf(err, "unmarshal task args failed")
		return
	}

	// Token transfers are now handled by the EQLiteRegistry smart contract
	err = errors.New("token transfers are deprecated - use EQLiteRegistry contract on Ethereum")
	return
}
