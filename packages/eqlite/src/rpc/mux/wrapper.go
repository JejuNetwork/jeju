
package mux

import (
	"eqlite/src/proto"
	"eqlite/src/rpc"
	"eqlite/src/utils/log"
)

// ServiceMap maps service name to service instance.
type ServiceMap rpc.ServiceMap

// Server is the RPC server struct.
type Server struct {
	*rpc.Server
}

// NewServer returns a new Server.
func NewServer() *Server {
	return &Server{
		Server: rpc.NewServerWithServeFunc(ServeMux),
	}
}

// NewServerWithService returns a new Server and registers the Server.ServiceMap.
func NewServerWithService(serviceMap ServiceMap) (server *Server, err error) {
	server = NewServer()
	for k, v := range serviceMap {
		err = server.RegisterService(k, v)
		if err != nil {
			log.Fatal(err)
			return nil, err
		}
	}
	return
}

// WithAcceptConnFunc resets the AcceptConn function of server.
func (s *Server) WithAcceptConnFunc(f rpc.AcceptConn) *Server {
	s.Server.WithAcceptConnFunc(f)
	return s
}

// Caller is a wrapper for session pooling and RPC calling.
type Caller struct {
	*rpc.Caller
}

// NewCaller returns a new RPCCaller.
func NewCaller() *Caller {
	return &Caller{
		Caller: rpc.NewCallerWithPool(defaultPool),
	}
}

// PersistentCaller is a wrapper for session pooling and RPC calling.
type PersistentCaller struct {
	*rpc.PersistentCaller
}

// NewPersistentCaller returns a persistent RPCCaller.
//  IMPORTANT: If a PersistentCaller is firstly used by a DHT.Ping, which is an anonymous
//  ETLS connection. It should not be used by any other RPC except DHT.Ping.
func NewPersistentCaller(target proto.NodeID) *PersistentCaller {
	return &PersistentCaller{
		PersistentCaller: rpc.NewPersistentCallerWithPool(defaultPool, target),
	}
}

// New returns brand new persistent caller.
func (c *PersistentCaller) New() rpc.PCaller {
	return NewPersistentCaller(c.TargetID)
}
