
package route

import (
	"fmt"
	"path/filepath"
	"runtime"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/conf"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const PubKeyStorePath = "./acl.keystore"

func TestIsPermitted(t *testing.T) {
	log.SetLevel(log.DebugLevel)
	utils.RemoveAll(PubKeyStorePath + "*")
	defer utils.RemoveAll(PubKeyStorePath + "*")

	_, testFile, _, _ := runtime.Caller(0)
	confFile := filepath.Join(filepath.Dir(testFile), "../test/node_0/config.yaml")

	conf.GConf, _ = conf.LoadConfig(confFile)
	log.Debugf("GConf: %#v", conf.GConf)
	// reset the once
	Once.Reset()
	InitKMS(PubKeyStorePath)

	Convey("test IsPermitted", t, func() {
		nodeID := proto.NodeID("0000")
		testEnv := &proto.Envelope{NodeID: nodeID.ToRawNodeID()}
		testAnonymous := &proto.Envelope{NodeID: kms.AnonymousRawNodeID}
		So(IsPermitted(&proto.Envelope{NodeID: &conf.GConf.BP.RawNodeID}, DHTGSetNode), ShouldBeTrue)
		So(IsPermitted(testEnv, DHTGSetNode), ShouldBeFalse)
		So(IsPermitted(testEnv, DHTFindNode), ShouldBeTrue)
		So(IsPermitted(testEnv, RemoteFunc(9999)), ShouldBeFalse)
		So(IsPermitted(testAnonymous, DHTFindNode), ShouldBeFalse)
	})

	Convey("string RemoteFunc", t, func() {
		for i := DHTPing; i < MaxRPCOffset; i++ {
			So(fmt.Sprintf("%s", RemoteFunc(i)), ShouldContainSubstring, ".")
		}
		So(fmt.Sprintf("%s", RemoteFunc(9999)), ShouldContainSubstring, "Unknown")
	})

}
