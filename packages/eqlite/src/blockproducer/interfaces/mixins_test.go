
package interfaces

import (
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"
)

func TestTransactionTypeMixin(t *testing.T) {
	Convey("test transaction type mixin", t, func() {
		m := NewTransactionTypeMixin(TransactionTypeBaseAccount)
		So(m.GetTransactionType(), ShouldEqual, TransactionTypeBaseAccount)
		m.SetTransactionType(TransactionTypeTransfer)
		So(m.GetTransactionType(), ShouldEqual, TransactionTypeTransfer)
		now := time.Now()
		So(now.Sub(m.GetTimestamp()).Seconds(), ShouldBeLessThan, 0.1)
		m.SetTimestamp(now)
		So(m.GetTimestamp(), ShouldEqual, now)
	})
}
