
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/proto"
)

func TestIssueKeys(t *testing.T) {
	Convey("test IssueKeys", t, func() {
		var (
			err      error
			privKey1 *asymmetric.PrivateKey
			privKey3 *asymmetric.PrivateKey
			addr1    proto.AccountAddress
			addr3    proto.AccountAddress
		)

		// Create key pairs and addresses for test
		privKey1, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		privKey3, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		addr1, err = crypto.PubKeyHash(privKey1.PubKey())
		So(err, ShouldBeNil)
		addr3, err = crypto.PubKeyHash(privKey3.PubKey())
		So(err, ShouldBeNil)

		ik1 := &IssueKeys{}
		err = ik1.Sign(privKey1)
		So(err, ShouldBeNil)
		err = ik1.Verify()
		So(err, ShouldBeNil)
		addr := ik1.GetAccountAddress()
		So(addr, ShouldEqual, addr1)
		nonce := ik1.GetAccountNonce()
		So(nonce, ShouldEqual, 0)

		ik2 := NewIssueKeys(
			&IssueKeysHeader{
				TargetSQLChain: addr1,
				Nonce:          3,
			},
		)
		err = ik2.Sign(privKey3)
		So(err, ShouldBeNil)
		err = ik2.Verify()
		So(err, ShouldBeNil)
		addr = ik2.GetAccountAddress()
		So(addr, ShouldEqual, addr3)
		nonce = ik2.GetAccountNonce()
		So(nonce, ShouldEqual, 3)

		var nilAddr proto.AccountAddress
		ik3 := &IssueKeys{}
		err = ik3.Verify()
		So(err, ShouldNotBeNil)
		addr = ik3.GetAccountAddress()
		So(addr, ShouldEqual, nilAddr)
		nonce = ik3.GetAccountNonce()
		So(nonce, ShouldEqual, 0)
	})
}
