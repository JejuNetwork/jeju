
package rpc

import (
	"context"
	"net"

	"eqlite/src/crypto/etls"
	"eqlite/src/utils/log"
)

// AcceptRawConn accepts raw connection without encryption or node-oriented mechanism.
//
// Corresponding dialer is net.Dial.
func AcceptRawConn(ctx context.Context, conn net.Conn) (net.Conn, error) {
	// TODO(leventeliu): pass context.
	return conn, nil
}

// NewAcceptCryptoConnFunc returns a AcceptConn function which accepts raw connection and uses the
// cipher handler to handle it as etls.CryptoConn.
//
// Corresponding dialer is crypto/etls.Dial.
func NewAcceptCryptoConnFunc(handler etls.CipherHandler) AcceptConn {
	return func(ctx context.Context, conn net.Conn) (net.Conn, error) {
		cryptoConn, err := handler(conn)
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return cryptoConn, nil
	}
}

// AcceptNAConn accepts connection as a naconn.NAConn.
//
// Default accept function of RPC server, and also the only accept function for
// the connections from a NAConnPool.
//
// Corresponding dialer is naconn.Dial/naconn.DialEx.
func AcceptNAConn(ctx context.Context, conn net.Conn) (net.Conn, error) {
	naconn, err := Accept(conn)
	if err != nil {
		log.WithFields(log.Fields{
			"local":  conn.LocalAddr(),
			"remote": conn.RemoteAddr(),
		}).WithError(err).Error("failed to accept NAConn")
		_ = conn.Close()
		return nil, err
	}
	return naconn, nil
}
