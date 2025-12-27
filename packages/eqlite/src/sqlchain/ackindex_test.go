
package sqlchain

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/proto"
	"eqlite/src/types"
)

func TestAckIndex(t *testing.T) {
	Convey("Given a ackIndex instance", t, func() {
		var (
			err error

			ai   = newAckIndex()
			resp = &types.SignedResponseHeader{
				ResponseHeader: types.ResponseHeader{
					Request: types.RequestHeader{
						NodeID: proto.NodeID(
							"0000000000000000000000000000000000000000000000000000000000000000"),
						ConnectionID: 0,
						SeqNo:        0,
					},
				},
			}
			ack = &types.SignedAckHeader{
				AckHeader: types.AckHeader{
					Response: resp.ResponseHeader,
				},
			}
		)
		Convey("Add response and register ack should return no error", func() {
			err = ai.addResponse(0, resp)
			So(err, ShouldBeNil)
			err = ai.register(0, ack)
			So(err, ShouldBeNil)
			err = ai.remove(0, ack)
			So(err, ShouldBeNil)
		})
	})
}
