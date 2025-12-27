
package types

import (
	"eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// ProvideServiceHeader defines the miner providing service transaction header.
// Note: Staking and deposits are now handled by the EQLiteRegistry smart contract.
type ProvideServiceHeader struct {
	Space         uint64  // reserved storage space in bytes
	Memory        uint64  // reserved memory in bytes
	LoadAvgPerCPU float64 // max loadAvg15 per CPU
	TargetUser    []proto.AccountAddress
	NodeID        proto.NodeID
	Nonce         interfaces.AccountNonce
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (h *ProvideServiceHeader) GetAccountNonce() interfaces.AccountNonce {
	return h.Nonce
}

// ProvideService defines the miner providing service transaction.
type ProvideService struct {
	ProvideServiceHeader
	interfaces.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewProvideService returns new instance.
func NewProvideService(h *ProvideServiceHeader) *ProvideService {
	return &ProvideService{
		ProvideServiceHeader: *h,
		TransactionTypeMixin: *interfaces.NewTransactionTypeMixin(interfaces.TransactionTypeProvideService),
	}
}

// Sign implements interfaces/Transaction.Sign.
func (ps *ProvideService) Sign(signer *asymmetric.PrivateKey) (err error) {
	return ps.DefaultHashSignVerifierImpl.Sign(&ps.ProvideServiceHeader, signer)
}

// Verify implements interfaces/Transaction.Verify.
func (ps *ProvideService) Verify() error {
	return ps.DefaultHashSignVerifierImpl.Verify(&ps.ProvideServiceHeader)
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (ps *ProvideService) GetAccountAddress() proto.AccountAddress {
	addr, _ := crypto.PubKeyHash(ps.Signee)
	return addr
}

func init() {
	interfaces.RegisterTransaction(interfaces.TransactionTypeProvideService, (*ProvideService)(nil))
}
