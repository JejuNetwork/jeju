
package verifier

import "errors"

var (
	// ErrHashValueNotMatch indicates the hash value not match error from verifier.
	ErrHashValueNotMatch = errors.New("hash value not match")
	// ErrSignatureNotMatch indicates the signature not match error from verifier.
	ErrSignatureNotMatch = errors.New("signature not match")
)
