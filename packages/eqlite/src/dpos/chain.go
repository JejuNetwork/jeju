
package dpos

import (
	"database/sql"
	"time"

	ca "eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/types"
	"eqlite/src/utils/log"
	xi "eqlite/src/dpos/interfaces"
	xs "eqlite/src/dpos/sqlite"
)

// Chain defines the dpos chain structure.
type Chain struct {
	state *State
	// Cached fields
	priv *ca.PrivateKey
}

// NewChain returns new chain instance.
func NewChain(filename string) (c *Chain, err error) {
	var (
		strg xi.Storage
		priv *ca.PrivateKey
	)
	// generate empty nodeId
	nodeID := proto.NodeID("0000000000000000000000000000000000000000000000000000000000000000")

	// TODO(leventeliu): add multiple storage engine support.
	if strg, err = xs.NewSqlite(filename); err != nil {
		return
	}
	if priv, err = kms.GetLocalPrivateKey(); err != nil {
		return
	}
	c = &Chain{
		state: NewState(sql.LevelReadUncommitted, nodeID, strg),
		priv:  priv,
	}
	return
}

// Query queries req from local chain state and returns the query results in resp.
func (c *Chain) Query(req *types.Request) (resp *types.Response, err error) {
	var (
		ref   *QueryTracker
		start = time.Now()

		queried, signed, updated time.Duration
	)
	defer func() {
		var fields = log.Fields{}
		if queried > 0 {
			fields["1#queried"] = float64(queried.Nanoseconds()) / 1000
		}
		if signed > 0 {
			fields["2#signed"] = float64((signed - queried).Nanoseconds()) / 1000
		}
		if updated > 0 {
			fields["3#updated"] = float64((updated - signed).Nanoseconds()) / 1000
		}
		log.WithFields(fields).Debug("Chain.Query duration stat (us)")
	}()
	if ref, resp, err = c.state.Query(req, true); err != nil {
		return
	}
	queried = time.Since(start)
	if err = resp.BuildHash(); err != nil {
		return
	}
	signed = time.Since(start)
	ref.UpdateResp(resp)
	updated = time.Since(start)
	return
}

// Stop stops chain workers and RPC service.
func (c *Chain) Stop() (err error) {
	// Close all opened resources
	return c.state.Close(true)
}
