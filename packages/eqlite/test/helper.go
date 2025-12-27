
package test

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pkg/errors"

	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/types"
)

// WaitBPChainService waits until BP chain service is ready.
func WaitBPChainService(ctx context.Context, period time.Duration) (err error) {
	var (
		ticker = time.NewTicker(period)
		req    = &types.FetchBlockReq{
			Height: 0, // Genesis block
		}
	)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err = rpc.RequestBP(
				route.MCCFetchBlock.String(), req, nil,
			); err == nil || !strings.Contains(err.Error(), "can't find service") {
				return
			}
		case <-ctx.Done():
			err = ctx.Err()
			return
		}
	}
}

// Create allocates new database.
func Create(
	meta types.ResourceMeta,
	gasPrice uint64,
	advancePayment uint64,
	privateKey *asymmetric.PrivateKey,
) (
	dbID proto.DatabaseID, dsn string, err error,
) {
	var (
		nonceReq   = new(types.NextAccountNonceReq)
		nonceResp  = new(types.NextAccountNonceResp)
		req        = new(types.AddTxReq)
		resp       = new(types.AddTxResp)
		clientAddr proto.AccountAddress
	)
	if clientAddr, err = crypto.PubKeyHash(privateKey.PubKey()); err != nil {
		err = errors.Wrap(err, "get local account address failed")
		return
	}
	// allocate nonce
	nonceReq.Addr = clientAddr

	if err = rpc.RequestBP(route.MCCNextAccountNonce.String(), nonceReq, nonceResp); err != nil {
		err = errors.Wrap(err, "allocate create database transaction nonce failed")
		return
	}

	req.Tx = types.NewCreateDatabase(&types.CreateDatabaseHeader{
		Owner:        clientAddr,
		ResourceMeta: meta,
		Nonce:        nonceResp.Nonce,
	})

	if err = req.Tx.Sign(privateKey); err != nil {
		err = errors.Wrap(err, "sign request failed")
		return
	}

	if err = rpc.RequestBP(route.MCCAddTx.String(), req, resp); err != nil {
		err = errors.Wrap(err, "call create database transaction failed")
		return
	}

	dbID = proto.FromAccountAndNonce(clientAddr, uint32(nonceResp.Nonce))
	dsn = fmt.Sprintf("eqlite://%s", string(dbID))
	return
}
