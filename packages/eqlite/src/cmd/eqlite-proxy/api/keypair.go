
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/cmd/eqlite-proxy/utils"
	"eqlite/src/crypto/kms"
)

func genKeyPair(c *gin.Context) {
	r := struct {
		Password string `json:"password" form:"password"`
	}{}

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	// save key to persistence
	developer := getDeveloperID(c)

	p, err := model.AddNewPrivateKey(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrGenerateKeyPairFailed)
		return
	}

	// set as main account
	err = model.SetIfNoMainAccount(model.GetDB(c), developer, p.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSetMainAccountFailed)
		return
	}

	keyBytes, err := kms.EncodePrivateKey(p.Key, []byte(r.Password))
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrEncodePrivateKeyFailed)
		return
	}

	responseWithData(c, http.StatusOK, gin.H{
		"account": p.Account,
		"key":     string(keyBytes),
	})
}

func uploadKeyPair(c *gin.Context) {
	r := struct {
		Key      string `json:"key" form:"key" binding:"required"`
		Password string `json:"password" form:"password"`
	}{}

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	// decode key
	key, err := kms.DecodePrivateKey([]byte(r.Key), []byte(r.Password))
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrInvalidPrivateKeyUploaded)
		return
	}

	// save key to persistence
	developer := getDeveloperID(c)

	p, err := model.SavePrivateKey(model.GetDB(c), developer, key)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSavePrivateKeyFailed)
		return
	}

	// set as main account
	err = model.SetIfNoMainAccount(model.GetDB(c), developer, p.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSetMainAccountFailed)
		return
	}

	responseWithData(c, http.StatusOK, gin.H{
		"account": p.Account,
	})
}

func deleteKeyPair(c *gin.Context) {
	r := struct {
		Account utils.AccountAddress `json:"account" form:"account" uri:"account" binding:"required,len=64"`
		Force   bool                 `json:"force" form:"force"`
	}{}

	// ignore validation, check in later ShouldBind
	_ = c.ShouldBindUri(&r)

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	// check and delete private key
	developer := getDeveloperID(c)
	db := model.GetDB(c)

	account, err := model.GetAccount(db, developer, r.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrGetAccountFailed)
		return
	}

	// check account for projects
	var projects []*model.Project
	projects, err = model.GetUserProjects(db, developer, account.ID)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrGetProjectsFailed)
		return
	}

	if len(projects) > 0 {
		if r.Force {
			err = model.DeleteProjects(db, projects...)
			if err != nil {
				_ = c.Error(err)
				abortWithError(c, http.StatusInternalServerError, ErrDeleteProjectsFailed)
				return
			}
		} else {
			err = ErrKeyPairHasRelatedProjects
			abortWithError(c, http.StatusBadRequest, err)
			return
		}
	}

	p, err := model.DeletePrivateKey(db, developer, r.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrDeletePrivateKeyFailed)
		return
	}

	err = model.FixDeletedMainAccount(db, developer, p.ID)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrUnbindMainAccountFailed)
		return
	}

	responseWithData(c, http.StatusOK, nil)
}

func downloadKeyPair(c *gin.Context) {
	r := struct {
		Account  utils.AccountAddress `json:"account" form:"account" uri:"account" binding:"required,len=64"`
		Password string               `json:"password" form:"password"`
	}{}

	_ = c.ShouldBindUri(&r)

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	// check private key
	developer := getDeveloperID(c)

	p, err := model.GetPrivateKey(model.GetDB(c), developer, r.Account)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrGetAccountFailed)
		return
	}

	privateKeyBytes, err := kms.EncodePrivateKey(p.Key, []byte(r.Password))
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrEncodePrivateKeyFailed)
		return
	}

	responseWithData(c, http.StatusOK, gin.H{
		"key": string(privateKeyBytes),
	})
}
