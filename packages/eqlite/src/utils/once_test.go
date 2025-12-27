
package utils

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestOnce(t *testing.T) {
	Convey("test once", t, func() {
		var a = 0
		o := Once{}
		o.Do(func() {
			a++
		})
		o.Do(func() {
			a++
		})
		So(a, ShouldEqual, 1)
		o.Reset()
		o.Do(func() {
			a++
		})
		So(a, ShouldEqual, 2)
	})
}
