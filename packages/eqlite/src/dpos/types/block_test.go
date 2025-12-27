
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/crypto/verifier"
	"eqlite/src/types"
)

func TestBlock(t *testing.T) {
	Convey("Given a block and a pair of keys", t, func() {
		var (
			block = &Block{
				SignedBlockHeader: SignedBlockHeader{
					BlockHeader: BlockHeader{},
				},
				ReadQueries: []*types.Ack{
					{
						Header: types.SignedAckHeader{
							DefaultHashSignVerifierImpl: verifier.DefaultHashSignVerifierImpl{
								DataHash: hash.Hash{0x0, 0x0, 0x0, 0x1},
							},
						},
					},
				},
				WriteQueries: []*types.Ack{
					{
						Header: types.SignedAckHeader{
							DefaultHashSignVerifierImpl: verifier.DefaultHashSignVerifierImpl{
								DataHash: hash.Hash{0x0, 0x0, 0x0, 0x2},
							},
						},
					},
				},
			}
			priv, _, err = asymmetric.GenSecp256k1KeyPair()
		)
		So(err, ShouldBeNil)
		So(priv, ShouldNotBeNil)
		Convey("When the block is signed by the key pair", func() {
			err = block.Sign(priv)
			So(err, ShouldBeNil)
			Convey("The block should be verifiable", func() {
				err = block.Verify()
				So(err, ShouldBeNil)
			})
			Convey("The object should have data hash", func() {
				var enc, err = block.BlockHeader.MarshalHash()
				So(err, ShouldBeNil)
				So(enc, ShouldNotBeNil)
				So(block.SignedBlockHeader.Hash(), ShouldEqual, hash.THashH(enc))
			})
			Convey("When the queries is modified", func() {
				block.ReadQueries = append(block.ReadQueries, &types.Ack{
					Header: types.SignedAckHeader{
						DefaultHashSignVerifierImpl: verifier.DefaultHashSignVerifierImpl{
							DataHash: hash.Hash{0x0, 0x0, 0x0, 0x3},
						},
					},
				})
				Convey("The verifier should return merkle root not match error", func() {
					err = block.Verify()
					So(err, ShouldEqual, ErrMerkleRootNotMatch)
				})
			})
		})
	})
}
