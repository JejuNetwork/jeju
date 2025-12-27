
package mux

import (
	"io"
	"net"
	nrpc "net/rpc"
	"strings"
	"sync"

	"github.com/pkg/errors"

	"eqlite/src/conf"
	"eqlite/src/rpc"
)

// RawCaller defines a raw rpc caller without any encryption.
type RawCaller struct {
	targetAddr string
	client     *nrpc.Client
	sync.RWMutex
}

// NewRawCaller creates the raw rpc caller to target node.
func NewRawCaller(targetAddr string) *RawCaller {
	return &RawCaller{
		targetAddr: targetAddr,
	}
}

func (c *RawCaller) isClientValid() bool {
	c.RLock()
	defer c.RUnlock()

	return c.client != nil
}

func (c *RawCaller) resetClient() (err error) {
	c.Lock()
	defer c.Unlock()

	if c.client != nil {
		_ = c.client.Close()
		c.client = nil
	}

	var conn net.Conn
	if conn, err = net.DialTimeout("tcp", c.targetAddr, conf.TCPDialTimeout); err != nil {
		err = errors.Wrapf(err, "dial to target %s failed", c.targetAddr)
		return
	}
	stream, err := NewOneOffMuxConn(conn)
	if err != nil {
		return
	}
	c.client = rpc.NewClient(stream)
	return
}

// Call issues client rpc call.
func (c *RawCaller) Call(method string, args interface{}, reply interface{}) (err error) {
	if !c.isClientValid() {
		if err = c.resetClient(); err != nil {
			return
		}
	}

	c.RLock()
	err = c.client.Call(method, args, reply)
	c.RUnlock()

	if err != nil {
		if err == io.EOF ||
			err == io.ErrUnexpectedEOF ||
			err == io.ErrClosedPipe ||
			err == nrpc.ErrShutdown ||
			strings.Contains(strings.ToLower(err.Error()), "shut down") ||
			strings.Contains(strings.ToLower(err.Error()), "broken pipe") {
			// if got EOF, retry once
			reconnectErr := c.resetClient()
			if reconnectErr != nil {
				err = errors.Wrap(reconnectErr, "reconnect failed")
			}
		}
		err = errors.Wrapf(err, "call %s failed", method)
	}
	return
}

// Close release underlying connection resources.
func (c *RawCaller) Close() {
	c.Lock()
	defer c.Unlock()
	if c.client != nil {
		_ = c.client.Close()
		c.client = nil
	}
}

// Target returns the request target for logging purpose.
func (c *RawCaller) Target() string {
	return c.targetAddr
}

// New returns brand new caller.
func (c *RawCaller) New() rpc.PCaller {
	return NewRawCaller(c.targetAddr)
}
