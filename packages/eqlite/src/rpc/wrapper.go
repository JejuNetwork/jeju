
package rpc

import (
	"eqlite/src/proto"
)

// NewServer return a new Server.
func NewServer() *Server {
	return NewServerWithServeFunc(ServeDirect)
}

// NewServerWithService returns a new Server and registers the Server.ServiceMap.
func NewServerWithService(serviceMap ServiceMap) (server *Server, err error) {
	server = NewServer()
	for k, v := range serviceMap {
		err = server.RegisterService(k, v)
		if err != nil {
			return nil, err
		}
	}
	return server, nil
}

// WithAcceptConnFunc resets the AcceptConn function of server.
func (s *Server) WithAcceptConnFunc(f AcceptConn) *Server {
	s.acceptConn = f
	return s
}

// PCaller defines generic interface shared with PersistentCaller and RawCaller.
type PCaller interface {
	Call(method string, request interface{}, reply interface{}) (err error)
	Close()
	Target() string
	New() PCaller // returns new instance of current caller
}

// NewCaller returns a new RPCCaller.
func NewCaller() *Caller {
	return NewCallerWithPool(defaultPool)
}

// NewPersistentCaller returns a persistent RPCCaller.
//  IMPORTANT: If a PersistentCaller is firstly used by a DHT.Ping, which is an anonymous
//  ETLS connection. It should not be used by any other RPC except DHT.Ping.
func NewPersistentCaller(target proto.NodeID) *PersistentCaller {
	return NewPersistentCallerWithPool(defaultPool, target)
}
