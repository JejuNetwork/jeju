
package main

import (
	"net"

	mys "github.com/go-mysql-org/go-mysql/server"

	"eqlite/src/utils/log"
)

// Server defines the main logic of mysql protocol adapter.
type Server struct {
	listenAddr    string
	listener      net.Listener
	mysqlUser     string
	mysqlPassword string
}

// NewServer bind the service port and return a runnable adapter.
func NewServer(listenAddr string, user string, password string) (s *Server, err error) {
	s = &Server{
		listenAddr:    listenAddr,
		mysqlUser:     user,
		mysqlPassword: password,
	}

	if s.listener, err = net.Listen("tcp", listenAddr); err != nil {
		return
	}

	return
}

// Serve starts the server.
func (s *Server) Serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}

		go s.handleConn(conn)
	}
}

func (s *Server) handleConn(conn net.Conn) {
	h, err := mys.NewConn(conn, s.mysqlUser, s.mysqlPassword, NewCursor(s))

	if err != nil {
		log.WithError(err).Error("process connection failed")
		return
	}

	for {
		err = h.HandleCommand()
		if err != nil {
			return
		}
	}
}

// Shutdown ends the server.
func (s *Server) Shutdown() {
	s.listener.Close()
}
