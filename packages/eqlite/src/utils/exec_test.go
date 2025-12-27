
package utils

import (
	"bytes"
	"os"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/utils/log"
)

var (
	baseDir        = GetProjectSrcDir()
	testWorkingDir = FJ(baseDir, "./test/")
	logDir         = FJ(testWorkingDir, "./log/")
)

func TestRunServer(t *testing.T) {
	Convey("build", t, func() {
		log.SetLevel(log.DebugLevel)
		RunCommand(
			"/bin/ls",
			[]string{},
			"ls", testWorkingDir, logDir, true,
		)
		lsOut, _ := os.ReadFile(FJ(logDir, "ls.log"))
		So(bytes.ContainsAny(lsOut, "node_c"), ShouldBeTrue)

		err := RunCommand(
			"/bin/xxxxx",
			[]string{},
			"ls", testWorkingDir, logDir, false,
		)
		So(err, ShouldNotBeNil)

		err = RunCommand(
			"/bin/ls",
			[]string{},
			"ls", testWorkingDir+"noexist", logDir, false,
		)
		So(err, ShouldNotBeNil)

		err = RunCommand(
			"/bin/ls",
			[]string{},
			"ls", testWorkingDir, logDir+"noexist", true,
		)
		So(err, ShouldNotBeNil)
	})
}
