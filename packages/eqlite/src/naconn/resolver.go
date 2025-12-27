
package naconn

import "eqlite/src/proto"

// Resolver defines the node ID resolver interface for node-oriented connection.
type Resolver interface {
	Resolve(id *proto.RawNodeID) (string, error)
	ResolveEx(id *proto.RawNodeID) (*proto.Node, error)
}

var (
	defaultResolver Resolver
)

// RegisterResolver registers the default resolver.
func RegisterResolver(resolver Resolver) {
	defaultResolver = resolver
}
