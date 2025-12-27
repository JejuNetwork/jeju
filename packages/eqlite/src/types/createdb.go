
package types

import (
	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// CreateDatabaseHeader defines the database creation transaction header.
// Note: Staking and payments are now handled by the EQLiteRegistry smart contract.
type CreateDatabaseHeader struct {
	Owner        proto.AccountAddress
	ResourceMeta ResourceMeta
	Nonce        pi.AccountNonce
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (h *CreateDatabaseHeader) GetAccountNonce() pi.AccountNonce {
	return h.Nonce
}

// CreateDatabase defines the database creation transaction.
type CreateDatabase struct {
	CreateDatabaseHeader
	pi.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewCreateDatabase returns new instance.
func NewCreateDatabase(header *CreateDatabaseHeader) *CreateDatabase {
	return &CreateDatabase{
		CreateDatabaseHeader: *header,
		TransactionTypeMixin: *pi.NewTransactionTypeMixin(pi.TransactionTypeCreateDatabase),
	}
}

// Sign implements interfaces/Transaction.Sign.
func (cd *CreateDatabase) Sign(signer *asymmetric.PrivateKey) (err error) {
	return cd.DefaultHashSignVerifierImpl.Sign(&cd.CreateDatabaseHeader, signer)
}

// Verify implements interfaces/Transaction.Verify.
func (cd *CreateDatabase) Verify() error {
	return cd.DefaultHashSignVerifierImpl.Verify(&cd.CreateDatabaseHeader)
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (cd *CreateDatabase) GetAccountAddress() proto.AccountAddress {
	addr, _ := crypto.PubKeyHash(cd.Signee)
	return addr
}

func init() {
	pi.RegisterTransaction(pi.TransactionTypeCreateDatabase, (*CreateDatabase)(nil))
}
