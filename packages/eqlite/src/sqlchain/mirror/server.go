
package mirror

import (
	"net"

	"github.com/pkg/errors"

	"eqlite/src/rpc"
	"eqlite/src/rpc/mux"
)

func createServer(listenAddr string) (s *mux.Server, err error) {
	var l net.Listener
	if l, err = net.Listen("tcp", listenAddr); err != nil {
		err = errors.Wrap(err, "listen rpc server failed")
		return
	}

	s = mux.NewServer().WithAcceptConnFunc(rpc.AcceptRawConn)
	s.SetListener(l)

	return
}

// StartMirror starts the mirror server and start mirror database.
func StartMirror(database string, listenAddr string) (service *Service, err error) {
	var server *mux.Server
	if server, err = createServer(listenAddr); err != nil {
		return
	}

	if service, err = NewService(database, server); err != nil {
		return
	}

	// start mirror
	err = service.start()

	return
}

// StopMirror stops the mirror server.
func StopMirror(service *Service) {
	service.stop()
}
