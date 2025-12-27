
package worker

import (
	"time"

	"eqlite/src/proto"
	"eqlite/src/sqlchain"
)

// DBConfig defines the database config.
type DBConfig struct {
	DatabaseID             proto.DatabaseID
	RootDir                string
	DataDir                string
	BftRaftMux               *DBBftRaftMuxService
	ChainMux               *sqlchain.MuxService
	MaxWriteTimeGap        time.Duration
	EncryptionKey          string
	SpaceLimit             uint64
	UpdateBlockCount       uint64
	LastBillingHeight      int32
	UseEventualConsistency bool
	ConsistencyLevel       float64
	IsolationLevel         int
	SlowQueryTime          time.Duration
}
