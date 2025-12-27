package types

import (
	"encoding/json"

	"eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

// UserCost defines user cost information.
type UserCost struct {
	User   proto.AccountAddress
	Cost   uint64
	Miners []*MinerIncome
}

// MinerIncome defines miner income information.
type MinerIncome struct {
	Miner  proto.AccountAddress
	Income uint64
}

// BillingRange defines the block range for billing.
type BillingRange struct {
	From uint32
	To   uint32
}

// UpdateBillingHeader defines billing update header.
type UpdateBillingHeader struct {
	Users    []*UserCost
	Nonce    interfaces.AccountNonce
	Version  int32
	Receiver proto.AccountAddress
	Range    BillingRange
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (h *UpdateBillingHeader) GetAccountNonce() interfaces.AccountNonce {
	return h.Nonce
}

// UpdateBilling defines billing update transaction.
type UpdateBilling struct {
	UpdateBillingHeader
	interfaces.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewUpdateBilling creates a new UpdateBilling instance.
func NewUpdateBilling(header *UpdateBillingHeader) *UpdateBilling {
	return &UpdateBilling{
		UpdateBillingHeader: *header,
	}
}

// GetAccountAddress implements interfaces.Transaction.
func (ub *UpdateBilling) GetAccountAddress() proto.AccountAddress {
	return ub.Receiver
}

// MarshalHash marshals for hash computation.
func (ub *UpdateBilling) MarshalHash() ([]byte, error) {
	return json.Marshal(ub)
}

// Msgsize returns size estimate.
func (ub *UpdateBilling) Msgsize() int {
	return 1024
}

// Sign signs the transaction.
func (ub *UpdateBilling) Sign(signer *asymmetric.PrivateKey) error {
	return ub.DefaultHashSignVerifierImpl.Sign(&ub.UpdateBillingHeader, signer)
}

// Verify verifies the transaction signature.
func (ub *UpdateBilling) Verify() error {
	return ub.DefaultHashSignVerifierImpl.Verify(&ub.UpdateBillingHeader)
}

// MarshalHash marshals UpdateBillingHeader for hash computation.
func (h *UpdateBillingHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }

// Msgsize returns size estimate for UpdateBillingHeader.
func (h *UpdateBillingHeader) Msgsize() int { return 512 }

