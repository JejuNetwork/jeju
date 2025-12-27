
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestLogType_String(t *testing.T) {
	Convey("test log string function", t, func() {
		for i := LogPrepare; i <= LogNoop+1; i++ {
			So(i.String(), ShouldNotBeEmpty)
		}
	})
}
