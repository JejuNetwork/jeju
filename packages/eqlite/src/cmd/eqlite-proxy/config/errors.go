
package config

import "github.com/pkg/errors"

var (
	// ErrInvalidProxyConfig represents invalid proxy config without enough configurations.
	ErrInvalidProxyConfig = errors.New("invalid proxy config")
)
