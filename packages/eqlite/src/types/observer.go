
package types

const (
	// ReplicateFromBeginning is the replication offset observes from genesis block.
	ReplicateFromBeginning = int32(0)
	// ReplicateFromNewest is the replication offset observes from block head of current node.
	ReplicateFromNewest = int32(-1)
)
