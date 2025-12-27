
package config

import "github.com/pkg/errors"

var (
	// ErrInvalidStorageConfig defines error on incomplete storage config.
	ErrInvalidStorageConfig = errors.New("invalid storage config")
	// ErrInvalidCertificateFile defines invalid certificate file error.
	ErrInvalidCertificateFile = errors.New("invalid certificate file")
)
