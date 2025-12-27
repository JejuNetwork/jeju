
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"

	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/cmd/eqlite-proxy/utils"
)

func applyToken(c *gin.Context) {
	abortWithError(c, http.StatusGone, errors.New("token faucet removed - use EQLiteRegistry contract"))
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
		keys = append(keys, keyData)
	}

	apiResp["keypairs"] = keys

	responseWithData(c, http.StatusOK, apiResp)
}

func getBalance(c *gin.Context) {
	responseWithData(c, http.StatusOK, gin.H{
		"message": "Token balances are managed by EQLiteRegistry smart contract",
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
