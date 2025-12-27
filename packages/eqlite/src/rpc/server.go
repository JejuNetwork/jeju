

package rpc

import (
	"context"
	"io"
	"net"
	"net/rpc"

	"github.com/pkg/errors"

	"eqlite/src/crypto/kms"
	"eqlite/src/naconn"
	"eqlite/src/proto"
	"eqlite/src/utils/log"
)

// ServiceMap maps service name to service instance.
type ServiceMap map[string]interface{}

// AcceptConn defines the function type which accepts a raw connetion as a specific type
// of connection.
type AcceptConn func(ctx context.Context, conn net.Conn) (net.Conn, error)

// ServeStream defines the data stream serving function type which serves RPC at the given
// io.ReadWriteCloser.
type ServeStream func(
	ctx context.Context, server *rpc.Server, stream io.ReadWriteCloser, remote *proto.RawNodeID,
)

// Server is the RPC server struct.
type Server struct {
	ctx         context.Context
	cancel      context.CancelFunc
	rpcServer   *rpc.Server
	acceptConn  AcceptConn
	serveStream ServeStream
	Listener    net.Listener
}

// NewServerWithServeFunc return a new Server.
func NewServerWithServeFunc(f ServeStream) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		ctx:         ctx,
		cancel:      cancel,
		rpcServer:   rpc.NewServer(),
		acceptConn:  AcceptNAConn,
		serveStream: f,
	}
}

// InitRPCServer load the private key, init the crypto transfer layer and register RPC
// services.
// IF ANY ERROR returned, please raise a FATAL.
func (s *Server) InitRPCServer(
	addr string,
	privateKeyPath string,
	masterKey []byte,
) (err error) {
	//route.InitResolver()

	err = kms.InitLocalKeyPair(privateKeyPath, masterKey)
	if err != nil {
		err = errors.Wrap(err, "init local key pair failed")
		return
	}

	l, err := net.Listen("tcp", addr)
	if err != nil {
		err = errors.Wrap(err, "create crypto listener failed")
		return
	}

	s.SetListener(l)

	return
}

// SetListener set the service loop listener, used by func Serve main loop.
func (s *Server) SetListener(l net.Listener) {
	s.Listener = l
}

// Serve start the Server main loop,.
func (s *Server) Serve() {
serverLoop:
	for {
		select {
		case <-s.ctx.Done():
			log.Info("stopping Server Loop")
			break serverLoop
		default:
			conn, err := s.Listener.Accept()
			if err != nil {
				continue
			}
			log.WithField("remote", conn.RemoteAddr().String()).Info("accept")
			go s.serveConn(conn)
		}
	}
}

func (s *Server) serveConn(conn net.Conn) {
	le := log.WithField("remote_addr", conn.RemoteAddr())
	stream, err := s.acceptConn(s.ctx, conn)
	if err != nil {
		le.WithError(err).Error("failed to accept conn")
		return
	}
	defer func() { _ = stream.Close() }()
	// Acquire remote node id if it's a naconn.Remoter conn
	var remote *proto.RawNodeID
	if remoter, ok := stream.(naconn.Remoter); ok {
		id := remoter.Remote()
		remote = &id
		le = le.WithField("remote_node", id)
	}
	le.Debug("accept server conn")
	// Serve data stream
	s.serveStream(s.ctx, s.rpcServer, stream, remote)
}

// RegisterService registers service with a Service name, used by Client RPC.
func (s *Server) RegisterService(name string, service interface{}) error {
	return s.rpcServer.RegisterName(name, service)
}

// Stop Server main loop.
func (s *Server) Stop() {
	if s.Listener != nil {
		_ = s.Listener.Close()
	}
	s.cancel()
}
