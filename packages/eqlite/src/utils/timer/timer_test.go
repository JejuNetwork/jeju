
package timer

import (
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"
)

func TestTimer(t *testing.T) {
	Convey("test timer", t, func() {
		t := NewTimer()
		time.Sleep(time.Millisecond * 100)
		t.Add("stage1")

		time.Sleep(time.Second * 1)
		t.Add("stage2")

		m := t.ToMap()
		So(m, ShouldHaveLength, 3)
		So(m, ShouldContainKey, "stage1")
		So(m, ShouldContainKey, "stage2")
		So(m["stage1"], ShouldBeGreaterThanOrEqualTo, time.Millisecond*100)
		So(m["stage2"], ShouldBeGreaterThanOrEqualTo, time.Second)
		So(m["total"], ShouldBeGreaterThanOrEqualTo, time.Second+time.Millisecond*100)

		f := t.ToLogFields()
		So(f, ShouldHaveLength, 3)
		So(f, ShouldContainKey, "stage1")
		So(f, ShouldContainKey, "stage2")
		So(m["stage1"], ShouldEqual, f["stage1"])
		So(m["stage2"], ShouldEqual, f["stage2"])
		So(m["total"], ShouldEqual, f["total"])
	})
}
