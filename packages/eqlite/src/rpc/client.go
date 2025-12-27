

package rpc

import (
	"io"
	"net/rpc"

	"eqlite/src/utils"
)

// Client defines the RPC client interface.
type Client interface {
	Call(serviceMethod string, args interface{}, reply interface{}) error
	Go(serviceMethod string, args interface{}, reply interface{}, done chan *rpc.Call) *rpc.Call
	Close() error
}

// LastErrSetter defines the extend method to set client last error.
type LastErrSetter interface {
	SetLastErr(error)
}

// NewClient returns a new Client with stream.
//
// NOTE(leventeliu): ownership of stream is passed through:
//   io.Closer -> rpc.ClientCodec -> *rpc.Client
// Closing the *rpc.Client will cause io.Closer invoked.
func NewClient(stream io.ReadWriteCloser) (client *rpc.Client) {
	return rpc.NewClientWithCodec(utils.GetMsgPackClientCodec(stream))
}
