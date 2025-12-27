

package types

import (
	"eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// MinerKey defines an encryption key associated with miner address.
type MinerKey struct {
	Miner         proto.AccountAddress
	EncryptionKey string
}

// IssueKeysHeader defines an encryption key header.
type IssueKeysHeader struct {
	TargetSQLChain proto.AccountAddress
	MinerKeys      []MinerKey
	Nonce          interfaces.AccountNonce
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (h *IssueKeysHeader) GetAccountNonce() interfaces.AccountNonce {
	return h.Nonce
}

// IssueKeys defines the database creation transaction.
type IssueKeys struct {
	IssueKeysHeader
	interfaces.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewIssueKeys returns new instance.
func NewIssueKeys(header *IssueKeysHeader) *IssueKeys {
	return &IssueKeys{
		IssueKeysHeader:      *header,
		TransactionTypeMixin: *interfaces.NewTransactionTypeMixin(interfaces.TransactionTypeIssueKeys),
	}
}

// Sign implements interfaces/Transaction.Sign.
func (ik *IssueKeys) Sign(signer *asymmetric.PrivateKey) (err error) {
	return ik.DefaultHashSignVerifierImpl.Sign(&ik.IssueKeysHeader, signer)
}

// Verify implements interfaces/Transaction.Verify.
func (ik *IssueKeys) Verify() error {
	return ik.DefaultHashSignVerifierImpl.Verify(&ik.IssueKeysHeader)
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (ik *IssueKeys) GetAccountAddress() proto.AccountAddress {
	addr, _ := crypto.PubKeyHash(ik.Signee)
	return addr
}

func init() {
	interfaces.RegisterTransaction(interfaces.TransactionTypeIssueKeys, (*IssueKeys)(nil))
}
