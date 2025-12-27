
package utils

import (
	"os"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestRemoveAll(t *testing.T) {
	Convey("test remove files", t, func() {
		var names []string
		tempPattern := "_tempfile_test_never_duplicate_*"
		f, err := os.CreateTemp(".", tempPattern)
		So(err, ShouldBeNil)
		names = append(names, f.Name())
		_ = f.Close()
		f, err = os.CreateTemp(".", tempPattern)
		So(err, ShouldBeNil)
		names = append(names, f.Name())
		_ = f.Close()

		RemoveAll(tempPattern)

		for _, name := range names {
			_, err := os.Stat(name)
			So(err, ShouldNotBeNil)
			So(os.IsNotExist(err), ShouldBeTrue)
		}
	})
}
