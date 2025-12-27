
package types

import (
	"math/big"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
)

var (
	dummyHash = []byte{
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
		0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
	}
)

type DummyHeader struct{}

func (h *DummyHeader) MarshalHash() ([]byte, error) {
	return dummyHash, nil
}

type DummyObject struct {
	DummyHeader
	DefaultHashSignVerifierImpl
}

func (o *DummyObject) Sign(signer *asymmetric.PrivateKey) error {
	return o.DefaultHashSignVerifierImpl.Sign(&o.DummyHeader, signer)
}

func (o *DummyObject) Verify() error {
	return o.DefaultHashSignVerifierImpl.Verify(&o.DummyHeader)
}

func TestDefaultHashSignVerifierImpl(t *testing.T) {
	Convey("Given a dummy object and a pair of keys", t, func() {
		var (
			obj          = &DummyObject{}
			priv, _, err = asymmetric.GenSecp256k1KeyPair()
		)
		So(err, ShouldBeNil)
		So(priv, ShouldNotBeNil)
		Convey("When the object is signed by the key pair", func() {
			err = obj.Sign(priv)
			So(err, ShouldBeNil)
			Convey("The object should be verifiable", func() {
				err = obj.Verify()
				So(err, ShouldBeNil)
			})
			Convey("The object should have data hash", func() {
				So(obj.Hash(), ShouldEqual, hash.THashH(dummyHash))
			})
			Convey("When the hash is modified", func() {
				obj.DefaultHashSignVerifierImpl.DataHash = hash.Hash{0x0, 0x0, 0x0, 0x1}
				Convey("The verifier should return hash value not match error", func() {
					err = obj.Verify()
					So(err, ShouldEqual, ErrHashValueNotMatch)
				})
			})
			Convey("When the signee is modified", func() {
				var _, pub, err = asymmetric.GenSecp256k1KeyPair()
				So(err, ShouldBeNil)
				obj.DefaultHashSignVerifierImpl.Signee = pub
				Convey("The verifier should return signature not match error", func() {
					err = obj.Verify()
					So(err, ShouldEqual, ErrSignatureNotMatch)
				})
			})
			Convey("When the signature is modified", func() {
				var val = obj.DefaultHashSignVerifierImpl.Signature.R
				val.Add(val, big.NewInt(1))
				Convey("The verifier should return signature not match error", func() {
					err = obj.Verify()
					So(err, ShouldEqual, ErrSignatureNotMatch)
				})
			})
		})
	})
}
