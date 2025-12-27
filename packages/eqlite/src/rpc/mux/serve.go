
package mux

import (
	"context"
	"io"
	nrpc "net/rpc"

	"github.com/pkg/errors"
	mux "github.com/xtaci/smux"

	"eqlite/src/proto"
	"eqlite/src/rpc"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

// ServeMux takes conn and serves as a multiplexing server.
func ServeMux(
	ctx context.Context, server *nrpc.Server, rawStream io.ReadWriteCloser, remote *proto.RawNodeID,
) {
	sess, err := mux.Server(rawStream, mux.DefaultConfig())
	if err != nil {
		log.WithError(errors.Wrap(err, "create mux server failed")).Debug("mux server creation failed")
		return
	}
	defer func() { _ = sess.Close() }()

sessionLoop:
	for {
		select {
		case <-ctx.Done():
			log.Info("stopping Session Loop")
			break sessionLoop
		default:
			muxConn, err := sess.AcceptStream()
			if err != nil {
				if err == io.EOF {
					//log.WithField("remote", remoteNodeID).Debug("session connection closed")
				} else {
					log.WithError(errors.Wrapf(err, "session accept failed, remote: %s", remote)).Debug("session accept failed")
				}
				break sessionLoop
			}
			ctx, cancelFunc := context.WithCancel(context.Background())
			go func() {
				<-muxConn.GetDieCh()
				cancelFunc()
			}()
			nodeAwareCodec := rpc.NewNodeAwareServerCodec(ctx, utils.GetMsgPackServerCodec(muxConn), remote)
			go server.ServeCodec(nodeAwareCodec)
		}
	}
}
