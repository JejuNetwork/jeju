
package kms

import (
	"strings"

	"eqlite/src/proto"
)

// AnonymousXXX is only used for DHT.Ping

var (
	// AnonymousNodeID is the anonymous node id
	AnonymousNodeID = proto.NodeID(strings.Repeat("f", 64))
	// AnonymousRawNodeID is the anonymous node id
	AnonymousRawNodeID = AnonymousNodeID.ToRawNodeID()
)
