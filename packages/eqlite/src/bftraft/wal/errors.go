
package wal

import "github.com/pkg/errors"

var (
	// ErrWalClosed represents the log file is closed.
	ErrWalClosed = errors.New("wal is closed")
	// ErrInvalidLog represents the log object is invalid.
	ErrInvalidLog = errors.New("invalid log")
	// ErrAlreadyExists represents the log already exists.
	ErrAlreadyExists = errors.New("log already exists")
	// ErrNotExists represents the log does not exists.
	ErrNotExists = errors.New("log not exists")
)
