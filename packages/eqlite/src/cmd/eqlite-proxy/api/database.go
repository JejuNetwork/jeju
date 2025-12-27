
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	gorp "gopkg.in/gorp.v2"

	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/client"
	"eqlite/src/cmd/eqlite-proxy/config"
	"eqlite/src/cmd/eqlite-proxy/model"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/types"
	"eqlite/src/utils/log"
)

func createDB(c *gin.Context) {
	r := struct {
		NodeCount uint16 `json:"node" form:"node" binding:"gt=0"`
	}{}

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	developer := getDeveloperID(c)

	p, err := model.GetMainAccount(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrNoMainAccount)
		return
	}

	// run task
	taskID, err := getTaskManager(c).New(model.TaskCreateDB, developer, p.ID, gin.H{
		"node_count": r.NodeCount,
	})
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrCreateTaskFailed)
		return
	}

	responseWithData(c, http.StatusOK, gin.H{
		"task_id": taskID,
	})
}

func topUp(c *gin.Context) {
	abortWithError(c, http.StatusGone, errors.New("top-up removed - use EQLiteRegistry contract for staking"))
}

func databaseBalance(c *gin.Context) {
	r := struct {
		Database proto.DatabaseID `json:"db" form:"db" uri:"db" binding:"required,len=64"`
	}{}

	_ = c.ShouldBindUri(&r)

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	developer := getDeveloperID(c)
	p, err := model.GetMainAccount(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusForbidden, ErrNoMainAccount)
		return
	}

	var profile *types.SQLChainProfile
	if profile, err = getDatabaseProfile(r.Database); err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSendETLSRPCFailed)
		return
	}

	accountAddr, err := p.Account.Get()
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrParseAccountFailed)
		return
	}

	for _, user := range profile.Users {
		if user.Address == accountAddr {
			responseWithData(c, http.StatusOK, gin.H{})
			return
		}
	}

	abortWithError(c, http.StatusForbidden, ErrNotAuthorizedAdmin)
}

func databasePricing(c *gin.Context) {

}

func waitTx(c *gin.Context) {
	r := struct {
		Tx string `json:"tx" form:"tx" uri:"tx" binding:"required,len=64"`
	}{}

	_ = c.ShouldBindUri(&r)

	if err := c.ShouldBind(&r); err != nil {
		abortWithError(c, http.StatusBadRequest, err)
		return
	}

	var h hash.Hash

	if err := hash.Decode(&h, r.Tx); err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrInvalidTxHash)
		return
	}

	txState, err := client.WaitTxConfirmation(c.Request.Context(), h)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrWaitTxConfirmationTimeout)
		return
	}

	responseWithData(c, http.StatusOK, gin.H{
		"state": txState.String(),
	})
}

func databaseList(c *gin.Context) {
	// query account belongings
	developer := getDeveloperID(c)

	p, err := model.GetMainAccount(model.GetDB(c), developer)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusForbidden, ErrNoMainAccount)
		return
	}

	req := new(types.QueryAccountSQLChainProfilesReq)
	resp := new(types.QueryAccountSQLChainProfilesResp)

	accountAddr, err := p.Account.Get()
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusBadRequest, ErrParseAccountFailed)
		return
	}

	req.Addr = accountAddr
	err = rpc.RequestBP(route.MCCQueryAccountSQLChainProfiles.String(), req, resp)
	if err != nil {
		_ = c.Error(err)
		abortWithError(c, http.StatusInternalServerError, ErrSendETLSRPCFailed)
		return
	}

	var profiles []gin.H

	for _, p := range resp.Profiles {
		var profile = gin.H{}

		for _, user := range p.Users {
			if user.Address == accountAddr && user.Permission.HasSuperPermission() {
				profile["id"] = p.ID
				profiles = append(profiles, profile)
			}
		}
	}

	responseWithData(c, http.StatusOK, gin.H{
		"profiles": profiles,
	})
}

func createDatabase(db *gorp.DbMap, developer int64, account int64, nodeCount uint16) (tx hash.Hash, dbID proto.DatabaseID, key *asymmetric.PrivateKey, err error) {
	p, err := model.GetAccountByID(db, developer, account)
	if err != nil {
		err = errors.Wrapf(err, "get account for task failed")
		return
	}

	if err = p.LoadPrivateKey(); err != nil {
		err = errors.Wrapf(err, "decode account private key failed")
		return
	}

	key = p.Key

	accountAddr, err := p.Account.Get()
	if err != nil {
		err = errors.Wrapf(err, "decode task account failed")
		return
	}

	nonceReq := new(types.NextAccountNonceReq)
	nonceResp := new(types.NextAccountNonceResp)
	nonceReq.Addr = accountAddr

	err = rpc.RequestBP(route.MCCNextAccountNonce.String(), nonceReq, nonceResp)
	if err != nil {
		err = errors.Wrapf(err, "get account nonce failed")
		return
	}

	meta := client.ResourceMeta{}
	meta.Node = nodeCount

	var (
		txReq  = new(types.AddTxReq)
		txResp = new(types.AddTxResp)
	)

	txReq.TTL = 1
	txReq.Tx = types.NewCreateDatabase(&types.CreateDatabaseHeader{
		Owner: accountAddr,
		ResourceMeta: types.ResourceMeta{
			TargetMiners:           meta.TargetMiners,
			Node:                   meta.Node,
			Space:                  meta.Space,
			Memory:                 meta.Memory,
			LoadAvgPerCPU:          meta.LoadAvgPerCPU,
			EncryptionKey:          meta.EncryptionKey,
			UseEventualConsistency: meta.UseEventualConsistency,
			ConsistencyLevel:       meta.ConsistencyLevel,
			IsolationLevel:         meta.IsolationLevel,
		},
		Nonce: nonceResp.Nonce,
	})

	if err = txReq.Tx.Sign(p.Key); err != nil {
		err = errors.Wrapf(err, "sign create database tx failed")
		return
	}

	if err = rpc.RequestBP(route.MCCAddTx.String(), txReq, txResp); err != nil {
		err = errors.Wrapf(err, "send add tx transaction rpc failed")
		return
	}

	tx = txReq.Tx.Hash()
	dbID = proto.FromAccountAndNonce(accountAddr, uint32(nonceResp.Nonce))

	return
}

func waitForTxState(ctx context.Context, tx hash.Hash) (state pi.TransactionState, err error) {
	req := &types.QueryTxStateReq{
		Hash: tx,
	}

	for {
		select {
		case <-ctx.Done():
			err = ctx.Err()
			return
		case <-time.After(time.Second * 10):
			resp := &types.QueryTxStateResp{}
			err = rpc.RequestBP(route.MCCQueryTxState.String(), req, resp)
			if err != nil {
				log.WithError(errors.Wrapf(err, "query tx %s state failed", tx.String())).Debug("query tx state failed")
				continue
			}

			state = resp.State

			switch resp.State {
			case pi.TransactionStateConfirmed:
				return
			case pi.TransactionStateExpired, pi.TransactionStateNotFound:
				// set error
				err = errors.Errorf("tx %s expired", tx.String())
				return
			}
		}
	}
}

// CreateDatabaseTask handles the database creation process.
func CreateDatabaseTask(ctx context.Context, _ *config.Config, db *gorp.DbMap, t *model.Task) (r gin.H, err error) {
	args := struct {
		NodeCount uint16 `json:"node_count"`
	}{}

	err = json.Unmarshal(t.RawArgs, &args)
	if err != nil {
		err = errors.Wrapf(err, "unmarshal task args failed")
		return
	}

	tx, dbID, _, err := createDatabase(db, t.Developer, t.Account, args.NodeCount)
	if err != nil {
		err = errors.Wrapf(err, "create database failed")
		return
	}

	// wait for transaction to complete in several cycles
	timeoutCtx, cancelCtx := context.WithTimeout(ctx, 3*time.Minute)
	defer cancelCtx()

	lastState, _ := waitForTxState(timeoutCtx, tx)
	r = gin.H{
		"db":    dbID,
		"tx":    tx.String(),
		"state": lastState.String(),
	}

	return
}
