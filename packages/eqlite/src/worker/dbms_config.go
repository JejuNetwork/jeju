
package worker

import (
	"time"

	"eqlite/src/rpc"
	"eqlite/src/rpc/mux"
)

var (
	// DefaultMaxReqTimeGap defines max time gap between request and server.
	DefaultMaxReqTimeGap = time.Minute
)

// DBMSConfig defines the local multi-database management system config.
type DBMSConfig struct {
	RootDir          string
	Server           *mux.Server
	DirectServer     *rpc.Server // optional server to provide DBMS service
	MaxReqTimeGap    time.Duration
	OnCreateDatabase func()
}
