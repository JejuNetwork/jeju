
package types

import (
	"testing"

	"github.com/mohae/deepcopy"
	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

func TestBaseAccount(t *testing.T) {
	Convey("base account", t, func() {
		h, err := hash.NewHashFromStr("000005aa62048f85da4ae9698ed59c14ec0d48a88a07c15a32265634e7e64ade")
		So(err, ShouldBeNil)
		addr := proto.AccountAddress(*h)
		ba := NewBaseAccount(&Account{
			Address: addr,
		})
		So(ba.GetAccountAddress(), ShouldEqual, addr)
		So(ba.GetAccountNonce(), ShouldEqual, 0)
		So(ba.Hash(), ShouldEqual, hash.Hash{})
		priv, _, err := asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		So(ba.Sign(priv), ShouldBeNil)
		So(ba.Verify(), ShouldBeNil)
	})
}

func TestDeepcopier(t *testing.T) {
	Convey("base account", t, func() {
		var p1 = &SQLChainProfile{
			Miners: []*MinerInfo{
				&MinerInfo{},
				&MinerInfo{},
				&MinerInfo{},
			},
		}
		var p2 = deepcopy.Copy(p1).(*SQLChainProfile)
		t.Logf("%p %p", p1.Miners[0], p2.Miners[0])
		So(p1.Miners[0], ShouldNotEqual, p2.Miners[0])
	})
}
