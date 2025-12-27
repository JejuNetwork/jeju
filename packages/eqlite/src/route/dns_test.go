
package route

import (
	"path/filepath"
	"runtime"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/conf"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
	"eqlite/src/utils/log"
)

func TestResolver(t *testing.T) {
	log.SetLevel(log.DebugLevel)
	_, testFile, _, _ := runtime.Caller(0)
	confFile := filepath.Join(filepath.Dir(testFile), "../test/node_c/config.yaml")

	conf.GConf, _ = conf.LoadConfig(confFile)
	log.Debugf("GConf: %v", conf.GConf)

	Convey("resolver init", t, func() {
		setResolveCache(make(NodeIDAddressMap))
		addr, err := GetNodeAddrCache(&proto.RawNodeID{
			Hash: hash.Hash([32]byte{0xde, 0xad}),
		})
		So(err, ShouldEqual, ErrUnknownNodeID)
		So(addr, ShouldBeBlank)

		addr, err = GetNodeAddrCache(nil)
		So(err, ShouldEqual, ErrNilNodeID)
		So(addr, ShouldBeBlank)

		err = SetNodeAddrCache(nil, addr)
		So(err, ShouldEqual, ErrNilNodeID)

		nodeA := &proto.RawNodeID{
			Hash: hash.Hash([32]byte{0xaa, 0xaa}),
		}
		err = SetNodeAddrCache(nodeA, addr)
		So(err, ShouldBeNil)

		addr, err = GetNodeAddrCache(nodeA)
		So(err, ShouldBeNil)
		So(addr, ShouldEqual, addr)

		So(IsBPNodeID(nil), ShouldBeFalse)

		So(IsBPNodeID(nodeA), ShouldBeFalse)

		BPmap := initBPNodeIDs()
		log.Debugf("BPmap: %v", BPmap)
		BPs := GetBPs()
		dc := IPv6SeedClient{}
		ips, err := dc.GetBPFromDNSSeed(TestDomain)

		log.Debugf("BPs: %v", BPs)
		So(len(BPs), ShouldBeGreaterThanOrEqualTo, len(ips))
	})
}
