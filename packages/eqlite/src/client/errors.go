
package client

import "github.com/pkg/errors"

// Various errors the driver might returns.
var (
	// ErrQueryInTransaction represents a read query is presented during user transaction.
	ErrQueryInTransaction = errors.New("only write is supported during transaction")
	// ErrNotInitialized represents the driver is not initialized yet.
	ErrNotInitialized = errors.New("driver not initialized")
	// ErrAlreadyInitialized represents the driver is already initialized.
	ErrAlreadyInitialized = errors.New("driver already initialized")
	// ErrInvalidRequestSeq defines invalid sequence no of request.
	ErrInvalidRequestSeq = errors.New("invalid request sequence applied")
	// ErrInvalidProfile indicates the SQLChain profile is invalid.
	ErrInvalidProfile = errors.New("invalid sqlchain profile")
)
