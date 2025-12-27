
package client

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestExecResult(t *testing.T) {
	Convey("test result", t, func() {
		r := &execResult{
			affectedRows: 1,
			lastInsertID: 2,
		}

		i, err := r.LastInsertId()
		So(i, ShouldEqual, 2)
		So(err, ShouldBeNil)
		i, err = r.RowsAffected()
		So(i, ShouldEqual, 1)
		So(err, ShouldBeNil)
	})
}
