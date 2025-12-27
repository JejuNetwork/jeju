
package rpc

import (
	"eqlite/src/naconn"
	"eqlite/src/proto"
)

// The following variables define a method set to Dial/Accept node-oriented connections for
// this RPC package.
//
// TODO(leventeliu): allow to config other node-oriented connection dialer/accepter.
var (
	Dial   = naconn.Dial
	DialEx = naconn.DialEx
	Accept = naconn.Accept
)

// NOClientPool defines the node-oriented client pool interface.
type NOClientPool interface {
	Get(remote proto.NodeID) (Client, error)
	GetEx(remote proto.NodeID, isAnonymous bool) (Client, error)
	Close() error
}

// DialToNodeWithPool ties use connection in pool, if fails then connects to the node with nodeID.
func DialToNodeWithPool(pool NOClientPool, nodeID proto.NodeID, isAnonymous bool) (Client, error) {
	if isAnonymous {
		return pool.GetEx(nodeID, true)
	}
	//log.WithField("poolSize", pool.Len()).Debug("session pool size")
	return pool.Get(nodeID)
}
