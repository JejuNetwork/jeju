
package adapter

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"

	"github.com/gorilla/handlers"

	"eqlite/src/sqlchain/adapter/api"
	"eqlite/src/sqlchain/adapter/config"
)

// HTTPAdapter is a adapter for eqlite/alternative sqlite3 service.
type HTTPAdapter struct {
	server *http.Server
}

// NewHTTPAdapter creates adapter to service.
func NewHTTPAdapter(listenAddr string, configFile string, adapterUseMirrorAddr string) (adapter *HTTPAdapter, err error) {
	adapter = new(HTTPAdapter)

	// load config file
	var cfg *config.Config
	if cfg, err = config.LoadConfig(configFile); err != nil {
		return
	}

	if listenAddr != "" {
		cfg.ListenAddr = listenAddr
	}
	if adapterUseMirrorAddr != "" {
		cfg.MirrorServer = adapterUseMirrorAddr
	}
	// init server
	handler := handlers.CORS(
		handlers.AllowedHeaders([]string{"Content-Type"}),
	)(api.GetRouter())

	adapter.server = &http.Server{
		TLSConfig: cfg.TLSConfig,
		Addr:      cfg.ListenAddr,
		Handler:   handler,
	}

	return
}

// Serve defines adapter serve logic.
func (adapter *HTTPAdapter) Serve() (err error) {
	// start server
	cfg := config.GetConfig()

	// bind port, start tls listener
	var listener net.Listener
	if listener, err = net.Listen("tcp", adapter.server.Addr); err != nil {
		return
	}

	if cfg.TLSConfig != nil {
		listener = tls.NewListener(listener, cfg.TLSConfig)
	}

	// serve the connection
	go adapter.server.Serve(listener)

	return
}

// Shutdown shutdown the service.
func (adapter *HTTPAdapter) Shutdown(ctx context.Context) {
	if adapter.server != nil {
		adapter.server.Shutdown(ctx)
	}
}
