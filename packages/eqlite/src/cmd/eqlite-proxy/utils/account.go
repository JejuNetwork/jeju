
package utils

import (
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

// AccountAddress defines a proto.AccountAddress string wrapper.
type AccountAddress string

// Get returns the proto.AccountAddress from the wrapper.
func (a *AccountAddress) Get() (d proto.AccountAddress, err error) {
	err = hash.Decode((*hash.Hash)(&d), (string)(*a))
	return
}

// Set update the wrapper with new proto.AccountAddress.
func (a *AccountAddress) Set(d proto.AccountAddress) {
	*a = NewAccountAddress(d)
}

// NewAccountAddress returns new wrapper object of proto.AccountAddress.
func NewAccountAddress(d proto.AccountAddress) AccountAddress {
	return AccountAddress(d.String())
}
