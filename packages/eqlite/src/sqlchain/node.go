
package sqlchain

import "eqlite/src/proto"

// BlockID is the hash of block content.
type BlockID string

// StorageProofBlock records block's status.
type StorageProofBlock struct {
	// Block id
	ID BlockID
	// Nodes with index in the SQL chain.
	Nodes []proto.Node
}
