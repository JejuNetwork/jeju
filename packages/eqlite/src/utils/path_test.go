
package utils

import (
	"os"
	"os/user"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestCopyFile(t *testing.T) {
	Convey("copy file", t, func() {
		bytes := []byte("abc")
		defer os.Remove("testcopy")
		defer os.Remove("testcopy2")
		os.WriteFile("testcopy", bytes, 0600)
		CopyFile("testcopy", "testcopy2")
		bytes2, _ := os.ReadFile("testcopy2")
		So(bytes2, ShouldResemble, bytes)

		n, err := CopyFile("testcopy", "testcopy")
		So(err, ShouldBeNil)
		So(n, ShouldBeZeroValue)

		n, err = CopyFile("/path/not/exist", "testcopy")
		So(err, ShouldNotBeNil)
		So(n, ShouldBeZeroValue)

		n, err = CopyFile("testcopy", "/path/not/exist")
		So(err, ShouldNotBeNil)
		So(n, ShouldBeZeroValue)
	})
}

func TestHomeDirExpand(t *testing.T) {
	Convey("expand ~ dir", t, func() {
		usr, err := user.Current()
		So(err, ShouldBeNil)

		homeDir := HomeDirExpand("~")
		So(homeDir, ShouldEqual, usr.HomeDir)

		fullFilepathWithHome := HomeDirExpand("~/.local")
		So(fullFilepathWithHome, ShouldEqual, usr.HomeDir+"/.local")

		fullFilepathRaw := HomeDirExpand("/dev/null")
		So(fullFilepathRaw, ShouldEqual, "/dev/null")

		emptyPath := HomeDirExpand("")
		So(emptyPath, ShouldEqual, "")
	})
}

func TestExist(t *testing.T) {
	Convey("path exist or not", t, func() {
		So(Exist("/tmp/anemptypathshouldnotexist"), ShouldEqual, false)
		So(Exist("/"), ShouldEqual, true)
		So(Exist("/dev/null"), ShouldEqual, true)
	})
}
