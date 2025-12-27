
package utils

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestRemoveDuplicatesUnordered(t *testing.T) {
	Convey("deduplicate", t, func() {
		So(len(RemoveDuplicatesUnordered([]string{"123", "1", "11", "11", "123"})), ShouldEqual, 3)
	})
}
