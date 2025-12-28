package verifier

import (
	"eqlite/src/marshalhash"
)

// MarshalHash marshals DefaultHashSignVerifierImpl for hash computation
func (i *DefaultHashSignVerifierImpl) MarshalHash() ([]byte, error) {
	b := make([]byte, 0, 256)
	b = marshalhash.AppendArrayHeader(b, 3)
	b = marshalhash.AppendBytes(b, i.DataHash[:])
	// Signee (public key)
	if i.Signee != nil {
		b = marshalhash.AppendBytes(b, i.Signee.Serialize())
	} else {
		b = marshalhash.AppendNil(b)
	}
	// Signature
	if i.Signature != nil {
		b = marshalhash.AppendBytes(b, i.Signature.Serialize())
	} else {
		b = marshalhash.AppendNil(b)
	}
	return b, nil
}

// Msgsize returns the estimated size for msgpack encoding
func (i *DefaultHashSignVerifierImpl) Msgsize() int { return 256 }


