
package proto

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/utils"
)

func TestPeers(t *testing.T) {
	Convey("test peers", t, func() {
		privKey, _, err := asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		p := &Peers{
			PeersHeader: PeersHeader{
				Term:   1,
				Leader: NodeID("00000bef611d346c0cbe1beaa76e7f0ed705a194fdf9ac3a248ec70e9c198bf9"),
				Servers: []NodeID{
					NodeID("00000bef611d346c0cbe1beaa76e7f0ed705a194fdf9ac3a248ec70e9c198bf9"),
					NodeID("00000381d46fd6cf7742d7fb94e2422033af989c0e348b5781b3219599a3af35"),
				},
			},
		}
		err = p.Sign(privKey)
		So(err, ShouldBeNil)
		err = p.Verify()
		So(err, ShouldBeNil)

		// after encode/decode
		buf, err := utils.EncodeMsgPack(p)
		var peers *Peers
		err = utils.DecodeMsgPack(buf.Bytes(), &peers)
		So(err, ShouldBeNil)
		err = peers.Verify()
		So(err, ShouldBeNil)

		peers2 := peers.Clone()
		err = peers2.Verify()
		So(err, ShouldBeNil)

		i, found := peers.Find(NodeID("00000381d46fd6cf7742d7fb94e2422033af989c0e348b5781b3219599a3af35"))
		So(i, ShouldEqual, 1)
		So(found, ShouldBeTrue)

		i, found = peers.Find(NodeID("0000000000000000000000000000000000000000000000000000000000000001"))
		So(found, ShouldBeFalse)

		// verify hash failed
		peers.Term = 2
		err = peers.Verify()
		So(err, ShouldNotBeNil)
		err = peers.Sign(privKey)
		So(err, ShouldBeNil)

		// verify failed
		p.Signature = peers.Signature
		err = p.Verify()
		So(err, ShouldNotBeNil)
	})
}
