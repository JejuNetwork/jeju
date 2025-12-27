
package symmetric

import (
	"bytes"
	"crypto/aes"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

const (
	password = "EQLite.io"
	salt     = "auxten-key-salt-auxten"
)

func TestEncryptDecryptWithPassword(t *testing.T) {
	Convey("encrypt & decrypt 0 length string with aes256", t, func() {
		enc, err := EncryptWithPassword([]byte(""), []byte(password), []byte(salt))
		So(enc, ShouldNotBeNil)
		So(len(enc), ShouldEqual, 2*aes.BlockSize)
		So(err, ShouldBeNil)

		dec, err := DecryptWithPassword(enc, []byte(password), []byte(salt))
		So(dec, ShouldNotBeNil)
		So(len(dec), ShouldEqual, 0)
		So(err, ShouldBeNil)
	})

	Convey("encrypt & decrypt 0 length bytes with aes256", t, func() {
		enc, err := EncryptWithPassword([]byte(nil), []byte(password), []byte(salt))
		So(enc, ShouldNotBeNil)
		So(len(enc), ShouldEqual, 2*aes.BlockSize)
		So(err, ShouldBeNil)

		dec, err := DecryptWithPassword(enc, []byte(password), []byte(salt))
		So(dec, ShouldNotBeNil)
		So(len(dec), ShouldEqual, 0)
		So(err, ShouldBeNil)
	})

	Convey("encrypt & decrypt 1747 length bytes", t, func() {
		in := bytes.Repeat([]byte{0xff}, 1747)
		enc, err := EncryptWithPassword(in, []byte(password), []byte(salt))
		So(enc, ShouldNotBeNil)
		So(len(enc), ShouldEqual, (1747/aes.BlockSize+2)*aes.BlockSize)
		So(err, ShouldBeNil)

		dec, err := DecryptWithPassword(enc, []byte(password), []byte(salt))
		So(dec, ShouldNotBeNil)
		So(len(dec), ShouldEqual, 1747)
		So(err, ShouldBeNil)
	})

	Convey("decrypt error length bytes", t, func() {
		in := bytes.Repeat([]byte{0xff}, 1747)
		dec, err := DecryptWithPassword(in, []byte(password), []byte(salt))
		So(dec, ShouldBeNil)
		So(err, ShouldEqual, ErrInputSize)
	})
}
