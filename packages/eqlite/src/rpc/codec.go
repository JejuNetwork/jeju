

package rpc

import (
	"context"
	"net/rpc"

	"eqlite/src/proto"
)

// NodeAwareServerCodec wraps normal rpc.ServerCodec and inject node id during request process.
type NodeAwareServerCodec struct {
	rpc.ServerCodec
	NodeID *proto.RawNodeID
	Ctx    context.Context
}

// NewNodeAwareServerCodec returns new NodeAwareServerCodec with normal rpc.ServerCode and proto.RawNodeID.
func NewNodeAwareServerCodec(ctx context.Context, codec rpc.ServerCodec, nodeID *proto.RawNodeID) *NodeAwareServerCodec {
	return &NodeAwareServerCodec{
		ServerCodec: codec,
		NodeID:      nodeID,
		Ctx:         ctx,
	}
}

// ReadRequestBody override default rpc.ServerCodec behaviour and inject remote node id into request.
func (nc *NodeAwareServerCodec) ReadRequestBody(body interface{}) (err error) {
	err = nc.ServerCodec.ReadRequestBody(body)
	if err != nil {
		return
	}

	// test if request contains rpc envelope
	if body == nil {
		return
	}

	if r, ok := body.(proto.EnvelopeAPI); ok {
		// inject node id to rpc envelope
		r.SetNodeID(nc.NodeID)
		// inject context
		r.SetContext(nc.Ctx)
	}

	return
}
