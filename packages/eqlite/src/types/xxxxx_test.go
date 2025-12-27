
package types

import (
	"math"
	"strings"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/proto"
	"eqlite/src/utils"
)

func BenchmarkEncode(b *testing.B) {
	Convey("test encode decode", b, func(c C) {
		var (
			nodeID proto.NodeID
			addr   proto.AccountAddress
		)
		r := &Request{
			Header: SignedRequestHeader{
				RequestHeader: RequestHeader{
					QueryType:    ReadQuery,
					NodeID:       nodeID.ToRawNodeID().ToNodeID(),
					DatabaseID:   addr.DatabaseID(),
					ConnectionID: math.MaxUint64,
					SeqNo:        math.MaxUint64,
					Timestamp:    time.Now().UTC(),
					BatchCount:   1,
				},
			},
			Payload: RequestPayload{
				Queries: []Query{
					{
						Pattern: strings.Repeat("1", 1024),
						Args:    []NamedArg{},
					},
				},
			},
		}

		privKey, _, err := asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		So(privKey, ShouldNotBeNil)

		b.Run("a", func(b *testing.B) {
			for i := 0; i != b.N; i++ {
				err := r.Sign(privKey)

				req, err := utils.EncodeMsgPack(r)
				bs := req.Bytes()

				b.Logf("len: %v", len(bs))

				var e1 *Request
				err = utils.DecodeMsgPack(bs, &e1)
				err = e1.Verify()
				_ = err

				req, err = utils.EncodeMsgPack(r)
				bs = req.Bytes()
				var e2 *Request
				err = utils.DecodeMsgPack(bs, &e2)
				err = e2.Verify()

				req, err = utils.EncodeMsgPack(r)
				bs = req.Bytes()
				var e3 *Request
				err = utils.DecodeMsgPack(bs, &e3)
				err = e3.Verify()
			}
		})
	})
}
