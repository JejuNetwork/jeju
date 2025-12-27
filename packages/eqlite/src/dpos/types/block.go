
package types

import (
	"time"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/merkle"
	"eqlite/src/proto"
	"eqlite/src/types"
)

//go:generate hsp

// BlockHeader defines a block header.
type BlockHeader struct {
	Version     int32
	Producer    proto.NodeID
	GenesisHash hash.Hash
	ParentHash  hash.Hash
	MerkleRoot  hash.Hash
	Timestamp   time.Time
}

// SignedBlockHeader defines a block along with its hasher, signer and verifier.
type SignedBlockHeader struct {
	BlockHeader
	DefaultHashSignVerifierImpl
}

// Sign signs the block header.
func (h *SignedBlockHeader) Sign(signer *asymmetric.PrivateKey) error {
	return h.DefaultHashSignVerifierImpl.Sign(&h.BlockHeader, signer)
}

// Verify verifies the block header.
func (h *SignedBlockHeader) Verify() error {
	return h.DefaultHashSignVerifierImpl.Verify(&h.BlockHeader)
}

// Block defines a block including a signed block header and its query list.
type Block struct {
	SignedBlockHeader
	ReadQueries  []*types.Ack
	WriteQueries []*types.Ack
}

// Sign signs the block.
func (b *Block) Sign(signer *asymmetric.PrivateKey) (err error) {
	// Update header fields: generate merkle root from queries
	var hashes []*hash.Hash
	for _, v := range b.ReadQueries {
		h := v.Header.Hash()
		hashes = append(hashes, &h)
	}
	for _, v := range b.WriteQueries {
		h := v.Header.Hash()
		hashes = append(hashes, &h)
	}
	if err = b.MerkleRoot.SetBytes(merkle.NewMerkle(hashes).GetRoot()[:]); err != nil {
		return
	}
	// Sign block header
	return b.SignedBlockHeader.Sign(signer)
}

// Verify verifies the block.
func (b *Block) Verify() error {
	// Verify header fields: compare merkle root from queries
	var hashes []*hash.Hash
	for _, v := range b.ReadQueries {
		h := v.Header.Hash()
		hashes = append(hashes, &h)
	}
	for _, v := range b.WriteQueries {
		h := v.Header.Hash()
		hashes = append(hashes, &h)
	}
	if mroot := merkle.NewMerkle(hashes).GetRoot(); !mroot.IsEqual(
		&b.SignedBlockHeader.MerkleRoot,
	) {
		return ErrMerkleRootNotMatch
	}
	// Verify block header signature
	return b.SignedBlockHeader.Verify()
}
