
package blockproducer

import (
	"time"

	"eqlite/src/proto"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/types"
)

// RunMode defines modes that a bp can run as.
type RunMode int

const (
	// BPMode is the default and normal mode.
	BPMode RunMode = iota

	// APINodeMode makes the bp behaviour like an API gateway. It becomes an API
	// node, who syncs data from the bp network and exposes JSON-RPC API to users.
	APINodeMode
)

// Config is the main chain configuration.
type Config struct {
	Mode    RunMode
	Genesis *types.BPBlock

	DataFile string

	Server *rpc.Server

	Peers            *proto.Peers
	NodeID           proto.NodeID
	ConfirmThreshold float64

	Period time.Duration
	Tick   time.Duration

	BlockCacheSize int
}
