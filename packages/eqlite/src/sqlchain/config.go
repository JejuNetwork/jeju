
package sqlchain

import (
	"time"

	"eqlite/src/proto"
	"eqlite/src/types"
)

// Config represents a sql-chain config.
type Config struct {
	DatabaseID      proto.DatabaseID
	ChainFilePrefix string
	DataFile        string

	Genesis *types.Block
	Period  time.Duration
	Tick    time.Duration

	MuxService *MuxService
	Peers      *proto.Peers
	Server     proto.NodeID

	// QueryTTL sets the unacknowledged query TTL in block periods.
	QueryTTL      int32
	BlockCacheTTL int32

	// DBAccount info
	TokenType         types.TokenType
	GasPrice          uint64
	UpdatePeriod      uint64
	LastBillingHeight int32
	IsolationLevel    int
}
