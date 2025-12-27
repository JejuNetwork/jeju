
package rpc

import (
	"context"
	"io"
	"net/rpc"

	"eqlite/src/proto"
	"eqlite/src/utils"
)

// ServeDirect serves data stream directly.
func ServeDirect(
	ctx context.Context, server *rpc.Server, stream io.ReadWriteCloser, remote *proto.RawNodeID,
) {
	subctx, cancelFunc := context.WithCancel(ctx)
	defer cancelFunc()
	nodeAwareCodec := NewNodeAwareServerCodec(subctx, utils.GetMsgPackServerCodec(stream), remote)
	server.ServeCodec(nodeAwareCodec)
}
