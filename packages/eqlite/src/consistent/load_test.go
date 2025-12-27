
package consistent

import (
	"sort"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/kms"
	"eqlite/src/utils"
)

const testStorePath1 = "./test1.keystore"
const testStorePath2 = "./test2.keystore"

func TestSaveDHT(t *testing.T) {
	kms.Unittest = true
	utils.RemoveAll(testStorePath1 + "*")
	utils.RemoveAll(testStorePath2 + "*")
	//kms.ResetBucket()

	Convey("save DHT", t, func() {
		x, _ := InitConsistent(testStorePath1, new(KMSStorage), false)
		x.Add(NewNodeFromString("111111"))
		x.Add(NewNodeFromString(("3333")))
		So(len(x.circle), ShouldEqual, x.NumberOfReplicas*2)
		So(len(x.sortedHashes), ShouldEqual, x.NumberOfReplicas*2)
		So(sort.IsSorted(x.sortedHashes), ShouldBeTrue)
		kms.ClosePublicKeyStore()
		utils.CopyFile(testStorePath1, testStorePath2)
	})
}

func TestLoadDHT(t *testing.T) {
	Convey("load existing DHT", t, func() {
		kms.Unittest = true
		x, _ := InitConsistent(testStorePath2, new(KMSStorage), false)
		defer utils.RemoveAll(testStorePath1 + "*")
		defer utils.RemoveAll(testStorePath2 + "*")
		// with BP node, there should be 3 nodes
		So(len(x.circle), ShouldEqual, x.NumberOfReplicas*2)
		So(len(x.sortedHashes), ShouldEqual, x.NumberOfReplicas*2)
		So(sort.IsSorted(x.sortedHashes), ShouldBeTrue)
	})
}
