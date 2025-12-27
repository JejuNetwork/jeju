
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

func TestTxCreateDatabase(t *testing.T) {
	Convey("test tx create database", t, func() {
		h, err := hash.NewHashFromStr("000005aa62048f85da4ae9698ed59c14ec0d48a88a07c15a32265634e7e64ade")
		So(err, ShouldBeNil)

		cd := NewCreateDatabase(&CreateDatabaseHeader{
			Owner: proto.AccountAddress(*h),
			Nonce: 1,
		})

		So(cd.GetAccountNonce(), ShouldEqual, 1)

		priv, _, err := asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)

		err = cd.Sign(priv)
		So(err, ShouldBeNil)

		err = cd.Verify()
		So(err, ShouldBeNil)

		addr, err := crypto.PubKeyHash(priv.PubKey())
		So(err, ShouldBeNil)
		So(cd.GetAccountAddress(), ShouldEqual, addr)
	})
}
