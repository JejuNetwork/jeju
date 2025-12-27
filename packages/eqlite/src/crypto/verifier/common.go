
package verifier

import (
	"github.com/pkg/errors"

	ca "eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
)

//go:generate hsp

// MarshalHasher is the interface implemented by an object that can be stably marshalling hashed.
type MarshalHasher interface {
	MarshalHash() ([]byte, error)
}

// HashSignVerifier is the interface implemented by an object that contains a hash value of an
// MarshalHasher, can be signed by a private key and verified later.
type HashSignVerifier interface {
	Hash() hash.Hash
	SetHash(MarshalHasher) error
	SignHash(*ca.PrivateKey) error
	Sign(MarshalHasher, *ca.PrivateKey) error
	VerifyHash(MarshalHasher) error
	VerifySignature() error
	Verify(MarshalHasher) error
}

// DefaultHashSignVerifierImpl defines a default implementation of HashSignVerifier.
type DefaultHashSignVerifierImpl struct {
	DataHash  hash.Hash
	Signee    *ca.PublicKey
	Signature *ca.Signature
}

// Hash implements HashSignVerifier.Hash.
func (i *DefaultHashSignVerifierImpl) Hash() hash.Hash {
	return i.DataHash
}

// SetHash implements HashSignVerifier.SetHash.
func (i *DefaultHashSignVerifierImpl) SetHash(mh MarshalHasher) (err error) {
	var enc []byte
	if enc, err = mh.MarshalHash(); err != nil {
		return
	}
	i.DataHash = hash.THashH(enc)
	return
}

// SignHash implements HashSignVerifier.SignHash.
func (i *DefaultHashSignVerifierImpl) SignHash(signer *ca.PrivateKey) (err error) {
	if i.Signature, err = signer.Sign(i.DataHash[:]); err != nil {
		return
	}
	i.Signee = signer.PubKey()
	return
}

// Sign implements HashSignVerifier.Sign.
func (i *DefaultHashSignVerifierImpl) Sign(mh MarshalHasher, signer *ca.PrivateKey) (err error) {
	// Set hash
	if err = i.SetHash(mh); err != nil {
		return
	}
	err = i.SignHash(signer)
	return
}

// VerifyHash implements HashSignVerifier.VerifyHash.
func (i *DefaultHashSignVerifierImpl) VerifyHash(mh MarshalHasher) (err error) {
	var enc []byte
	if enc, err = mh.MarshalHash(); err != nil {
		return
	}
	var h = hash.THashH(enc)
	if !i.DataHash.IsEqual(&h) {
		err = errors.WithStack(ErrHashValueNotMatch)
		return
	}
	return
}

// VerifySignature implements HashSignVerifier.VerifySignature.
func (i *DefaultHashSignVerifierImpl) VerifySignature() (err error) {
	if !i.Signature.Verify(i.DataHash[:], i.Signee) {
		err = errors.WithStack(ErrSignatureNotMatch)
		return
	}
	return
}

// Verify implements HashSignVerifier.Verify.
func (i *DefaultHashSignVerifierImpl) Verify(mh MarshalHasher) (err error) {
	if err = i.VerifyHash(mh); err != nil {
		return
	}
	err = i.VerifySignature()
	return
}
