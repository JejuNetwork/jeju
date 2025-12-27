
package utils

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/utils/log"
)

type msgpackNestedStruct struct {
	C int64
}

type msgpackTestStruct struct {
	A string
	B msgpackNestedStruct
}

func TestMsgPack_EncodeDecode(t *testing.T) {
	Convey("primitive value encode decode test", t, func() {
		log.SetLevel(log.DebugLevel)
		i := uint64(1)
		buf, err := EncodeMsgPack(i)
		log.Debugf("uint64 1 encoded len %d to %x", len(buf.Bytes()), buf.Bytes())
		So(err, ShouldBeNil)
		var value uint64
		err = DecodeMsgPack(buf.Bytes(), &value)
		So(err, ShouldBeNil)
		So(value, ShouldEqual, i)
	})

	Convey("complex structure encode decode test", t, func() {
		preValue := &msgpackTestStruct{
			A: "happy",
			B: msgpackNestedStruct{
				C: 1,
			},
		}
		buf, err := EncodeMsgPack(preValue)
		So(err, ShouldBeNil)
		var postValue msgpackTestStruct
		err = DecodeMsgPack(buf.Bytes(), &postValue)
		So(err, ShouldBeNil)
		So(*preValue, ShouldResemble, postValue)
	})

	Convey("DecodeMsgPackPlain test", t, func() {
		log.SetLevel(log.DebugLevel)
		str := "test"
		buf, err := EncodeMsgPack(str)
		log.Debugf("string: test encoded len %d to %x", len(buf.Bytes()), buf.Bytes())
		So(err, ShouldBeNil)

		var value string
		err = DecodeMsgPackPlain(buf.Bytes(), &value)
		So(err, ShouldBeNil)
		So(value, ShouldEqual, str)

		var value2 string
		err = DecodeMsgPack(buf.Bytes(), &value2)
		So(err, ShouldBeNil)
		So(value2, ShouldEqual, str)
	})
}
