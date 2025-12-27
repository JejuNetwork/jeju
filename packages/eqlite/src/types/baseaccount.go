
package types

import (
	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

//go:generate hsp

// BaseAccount defines the base account type header.
type BaseAccount struct {
	Account
	pi.TransactionTypeMixin
}

// NewBaseAccount returns new instance.
func NewBaseAccount(account *Account) *BaseAccount {
	return &BaseAccount{
		Account:              *account,
		TransactionTypeMixin: *pi.NewTransactionTypeMixin(pi.TransactionTypeBaseAccount),
	}
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (b *BaseAccount) GetAccountAddress() proto.AccountAddress {
	return b.Address
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (b *BaseAccount) GetAccountNonce() pi.AccountNonce {
	// BaseAccount nonce is not counted, always return 0.
	return pi.AccountNonce(0)
}

// Hash implements interfaces/Transaction.Hash.
func (b *BaseAccount) Hash() (h hash.Hash) {
	return
}

// Sign implements interfaces/Transaction.Sign.
func (b *BaseAccount) Sign(signer *asymmetric.PrivateKey) (err error) {
	return
}

// Verify implements interfaces/Transaction.Verify.
func (b *BaseAccount) Verify() (err error) {
	return
}

func init() {
	pi.RegisterTransaction(pi.TransactionTypeBaseAccount, (*BaseAccount)(nil))
}
