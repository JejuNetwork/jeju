
package types

import (
	"errors"
)

var (
	// ErrMerkleRootVerification indicates a failed merkle root verificatin.
	ErrMerkleRootVerification = errors.New("merkle root verification failed")
	// ErrNodePublicKeyNotMatch indicates that the public key given with a node does not match the
	// one in the key store.
	ErrNodePublicKeyNotMatch = errors.New("node publick key doesn't match")
	// ErrSignVerification indicates a failed signature verification.
	ErrSignVerification = errors.New("signature verification failed")
	// ErrBillingNotMatch indicates that the billing request doesn't match the local result.
	ErrBillingNotMatch = errors.New("billing request doesn't match")
	// ErrHashVerification indicates a failed hash verification.
	ErrHashVerification = errors.New("hash verification failed")
	// ErrInvalidGenesis indicates a failed genesis block verification.
	ErrInvalidGenesis = errors.New("invalid genesis block")
)
