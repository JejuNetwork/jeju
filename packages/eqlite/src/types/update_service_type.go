
package types

import (
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// UpdateType defines service update type.
type UpdateType int32

const (
	// CreateDB indicates create database operation.
	CreateDB UpdateType = iota
	// UpdateDB indicates database peers update operation.
	UpdateDB
	// DropDB indicates drop database operation.
	DropDB
)

// UpdateServiceHeader defines service update header.
type UpdateServiceHeader struct {
	Op       UpdateType
	Instance ServiceInstance
}

// SignedUpdateServiceHeader defines signed service update header.
type SignedUpdateServiceHeader struct {
	UpdateServiceHeader
	verifier.DefaultHashSignVerifierImpl
}

// UpdateService defines service update type.
type UpdateService struct {
	proto.Envelope
	Header SignedUpdateServiceHeader
}

// UpdateServiceResponse defines empty response entity.
type UpdateServiceResponse struct{}

// Verify checks hash and signature in update service header.
func (sh *SignedUpdateServiceHeader) Verify() (err error) {
	return sh.DefaultHashSignVerifierImpl.Verify(&sh.UpdateServiceHeader)
}

// Sign the request.
func (sh *SignedUpdateServiceHeader) Sign(signer *asymmetric.PrivateKey) (err error) {
	return sh.DefaultHashSignVerifierImpl.Sign(&sh.UpdateServiceHeader, signer)
}

// Verify checks hash and signature in update service.
func (s *UpdateService) Verify() error {
	return s.Header.Verify()
}

// Sign the request.
func (s *UpdateService) Sign(signer *asymmetric.PrivateKey) (err error) {
	// sign
	return s.Header.Sign(signer)
}
