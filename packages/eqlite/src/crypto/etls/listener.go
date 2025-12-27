
package etls

import (
	"net"
)

// CipherHandler is the func type for converting net.Conn to CryptoConn.
type CipherHandler func(conn net.Conn) (cryptoConn *CryptoConn, err error)

// CryptoListener implements net.Listener.
type CryptoListener struct {
	net.Listener
	CHandler CipherHandler
}

// NewCryptoListener returns a new CryptoListener.
func NewCryptoListener(network, addr string, handler CipherHandler) (*CryptoListener, error) {
	l, err := net.Listen(network, addr)
	if err != nil {
		return nil, err
	}
	return &CryptoListener{l, handler}, nil
}

// Accept waits for and returns the next connection to the listener.
func (l *CryptoListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}

	return &CryptoConn{
		Conn: c,
	}, nil
}

// Close closes the listener.
// Any blocked Accept operations will be unblocked and return errors.
func (l *CryptoListener) Close() error {
	return l.Listener.Close()
}

// Addr returns the listener's network address.
func (l *CryptoListener) Addr() net.Addr {
	return l.Listener.Addr()
}
