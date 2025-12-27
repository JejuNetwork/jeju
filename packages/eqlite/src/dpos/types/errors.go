
package types

import (
	"errors"
)

var (
	// ErrMerkleRootNotMatch indicates the merkle root not match error from verifier.
	ErrMerkleRootNotMatch = errors.New("merkle root not match")
	// ErrHashValueNotMatch indicates the hash value not match error from verifier.
	ErrHashValueNotMatch = errors.New("hash value not match")
	// ErrSignatureNotMatch indicates the signature not match error from verifier.
	ErrSignatureNotMatch = errors.New("signature not match")
)
