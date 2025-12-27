
package etls

import (
	"bytes"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/hash"
)

func TestKeyDerivation(t *testing.T) {
	hSuite := &hash.HashSuite{
		HashLen:  hash.HashBSize,
		HashFunc: hash.DoubleHashB,
	}

	Convey("get addr", t, func() {
		rawKey := bytes.Repeat([]byte("a"), 1000)
		dKey := KeyDerivation(rawKey, 100, hSuite)
		So(dKey, ShouldHaveLength, 100)
	})
}
