
package wal

import (
	"io"
	"os"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	kt "eqlite/src/bftraft/types"
	"eqlite/src/proto"
)

func TestLevelDBWal_Write(t *testing.T) {
	Convey("wal write/get/close", t, func() {
		dbFile := "testWrite.ldb"

		var p *LevelDBWal
		var err error
		p, err = NewLevelDBWal(dbFile)
		So(err, ShouldBeNil)
		defer os.RemoveAll(dbFile)

		err = p.Write(nil)
		So(err, ShouldNotBeNil)

		l1 := &kt.Log{
			LogHeader: kt.LogHeader{
				Index:    0,
				Type:     kt.LogPrepare,
				Producer: proto.NodeID("0000000000000000000000000000000000000000000000000000000000000000"),
			},
			Data: []byte("happy1"),
		}

		err = p.Write(l1)
		So(err, ShouldBeNil)
		err = p.Write(l1)
		So(err, ShouldNotBeNil)

		// test get
		var l *kt.Log
		l, err = p.Get(l1.Index)
		So(err, ShouldBeNil)
		So(l, ShouldResemble, l1)

		_, err = p.Get(10000)
		So(err, ShouldNotBeNil)

		// test consecutive writes
		l2 := &kt.Log{
			LogHeader: kt.LogHeader{
				Index: 1,
				Type:  kt.LogPrepare,
			},
			Data: []byte("happy2"),
		}
		err = p.Write(l2)
		So(err, ShouldBeNil)

		// test not consecutive writes
		l4 := &kt.Log{
			LogHeader: kt.LogHeader{
				Index: 3,
				Type:  kt.LogPrepare,
			},
			Data: []byte("happy3"),
		}
		err = p.Write(l4)
		So(err, ShouldBeNil)

		l3 := &kt.Log{
			LogHeader: kt.LogHeader{
				Index: 2,
				Type:  kt.LogPrepare,
			},
			Data: []byte("happy4"),
		}
		err = p.Write(l3)
		So(err, ShouldBeNil)

		_, err = p.Read()
		So(err, ShouldEqual, io.EOF)

		p.Close()

		_, err = p.Read()
		So(err, ShouldEqual, ErrWalClosed)

		err = p.Write(l1)
		So(err, ShouldEqual, ErrWalClosed)

		_, err = p.Get(l1.Index)
		So(err, ShouldEqual, ErrWalClosed)

		// load again
		p, err = NewLevelDBWal(dbFile)
		So(err, ShouldBeNil)

		for i := 0; i != 4; i++ {
			l, err = p.Read()
			So(err, ShouldBeNil)
			So(l.Index, ShouldEqual, i)
		}

		_, err = p.Read()
		So(err, ShouldEqual, io.EOF)

		p.Close()

		// load again
		p, err = NewLevelDBWal(dbFile)
		So(err, ShouldBeNil)

		// not complete read
		for i := 0; i != 3; i++ {
			l, err = p.Read()
			So(err, ShouldBeNil)
			So(l.Index, ShouldEqual, i)
		}

		p.Close()

		// close multiple times
		So(p.Close, ShouldNotPanic)
	})
	Convey("open failed test", t, func() {
		_, err := NewLevelDBWal("")
		So(err, ShouldNotBeNil)
	})
}
