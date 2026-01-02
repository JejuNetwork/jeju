package jsonrpc

import (
	"context"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pkg/errors"
	"github.com/sourcegraph/jsonrpc2"
	wsstream "github.com/sourcegraph/jsonrpc2/websocket"

	"sqlit/src/utils/log"
)

// WebsocketServer is a websocket server providing JSON-RPC API service.
type WebsocketServer struct {
	http.Server
	RPCHandler jsonrpc2.Handler
}

// Serve accepts incoming connections and serve each.
func (ws *WebsocketServer) Serve() error {
	var (
		mux      = http.NewServeMux()
		upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		handler  = ws.RPCHandler
	)

	if handler == nil {
		handler = defaultHandler
	}

	// Add health check endpoints for compatibility with HTTP clients
	mux.HandleFunc("/v1/status", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(http.StatusOK)
		_, _ = rw.Write([]byte(`{"status":"ok","blockHeight":0,"databases":0}`))
	})

	mux.HandleFunc("/", func(rw http.ResponseWriter, r *http.Request) {
		// If it's not a WebSocket upgrade request, return 200 for health checks
		if r.Header.Get("Upgrade") != "websocket" {
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(http.StatusOK)
			_, _ = rw.Write([]byte(`{"status":"ok"}`))
			return
		}

		conn, err := upgrader.Upgrade(rw, r, nil)
		if err != nil {
			log.WithError(err).Error("jsonrpc: upgrade http connection to websocket failed")
			http.Error(rw, errors.WithMessage(err, "could not upgrade to websocket").Error(), http.StatusBadRequest)
			return
		}
		defer conn.Close()

		// TODO: add metric for the connections
		<-jsonrpc2.NewConn(
			context.Background(),
			wsstream.NewObjectStream(conn),
			handler,
		).DisconnectNotify()
	})

	addr := ws.Addr
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return errors.Wrapf(err, "couldn't bind to address %q", addr)
	}

	ws.Handler = mux
	return ws.Server.Serve(listener)
}

// Stop stops the server and returns a channel indicating server is stopped.
func (ws *WebsocketServer) Stop() {
	log.Warn("jsonrpc: shutdown server")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := ws.Server.Shutdown(ctx); err != nil {
		log.WithError(err).Error("jsonrpc: shutdown server")
	}
	cancel()
	log.Warn("jsonrpc: server stopped")
}
