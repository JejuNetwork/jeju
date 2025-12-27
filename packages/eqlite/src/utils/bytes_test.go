
package utils

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/utils/log"
)

func TestNewLevelDBKey(t *testing.T) {
	Convey("new bytes", t, func() {
		log.SetLevel(log.DebugLevel)
		So(ConcatAll(nil), ShouldResemble, []byte{})
		So(ConcatAll([]byte{}), ShouldResemble, []byte{})
		So(ConcatAll([]byte{'0'}, []byte{'1'}), ShouldResemble, []byte{'0', '1'})
		So(ConcatAll([]byte{'0'}, nil), ShouldResemble, []byte{'0'})
		So(ConcatAll(nil, []byte{'0'}), ShouldResemble, []byte{'0'})
		So(ConcatAll([]byte{'0', '1', '2', '3'}, []byte{'a', 'b', 'c', 'd', 'e'}, []byte{'x', 'y', 'z'}),
			ShouldResemble, []byte{'0', '1', '2', '3', 'a', 'b', 'c', 'd', 'e', 'x', 'y', 'z'})
		So(ConcatAll([]byte{'0', '1', '2', '3'}, nil, []byte{'x', 'y', 'z'}),
			ShouldResemble, []byte{'0', '1', '2', '3', 'x', 'y', 'z'})
		So(ConcatAll([]byte{'0', '1', '2', '3'}, []byte{}, []byte{'x', 'y', 'z'}),
			ShouldResemble, []byte{'0', '1', '2', '3', 'x', 'y', 'z'})
		So(ConcatAll(nil, []byte{'0', '1', '2', '3'}, nil, []byte{'x', 'y', 'z'}),
			ShouldResemble, []byte{'0', '1', '2', '3', 'x', 'y', 'z'})
		So(ConcatAll([]byte{}, []byte{'0', '1', '2', '3'}, nil, []byte{'x', 'y', 'z'}, nil),
			ShouldResemble, []byte{'0', '1', '2', '3', 'x', 'y', 'z'})
	})
}
