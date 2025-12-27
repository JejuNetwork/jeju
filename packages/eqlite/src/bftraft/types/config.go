
package types

import (
	"time"

	"eqlite/src/proto"
)

// RuntimeConfig defines the runtime config of bftraft.
type RuntimeConfig struct {
	// underlying handler.
	Handler Handler
	// minimum rpc success node percent requirement for prepare operation.
	PrepareThreshold float64
	// minimum rpc success node percent requirement for commit operation.
	CommitThreshold float64
	// maximum allowed time for prepare operation.
	PrepareTimeout time.Duration
	// maximum allowed time for commit operation.
	CommitTimeout time.Duration
	// init peers of node.
	Peers *proto.Peers
	// wal for bftraft.
	Wal Wal
	// current node id.
	NodeID proto.NodeID
	// current instance id.
	InstanceID string
	// mux service name.
	ServiceName string
	// apply service method.
	ApplyMethodName string
	// fetch service method.
	FetchMethodName string
	// fetch timeout.
	LogWaitTimeout time.Duration
}
