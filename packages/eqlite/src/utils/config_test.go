
package utils

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestDupConf(t *testing.T) {
	Convey("dup config file", t, func() {
		var d string
		var err error
		d, err = os.MkdirTemp("", "utils_test_")
		So(err, ShouldBeNil)
		dupConfFile := filepath.Join(d, "config.yaml")

		_, testFile, _, _ := runtime.Caller(0)
		confFile := filepath.Join(filepath.Dir(testFile), "../test/node_standalone/config.yaml")

		err = DupConf(confFile, dupConfFile)
		So(err, ShouldBeNil)

		err = DupConf("", dupConfFile)
		So(err, ShouldNotBeNil)

		err = DupConf(confFile, "")
		So(err, ShouldNotBeNil)
	})
}
