
package sqlite

import (
	"os"
	"runtime"
	"syscall"
	"testing"

	"eqlite/src/utils/log"
)

var (
	testingDataDir string
)

func setup() {
	const minNoFile uint64 = 4096
	var (
		err error
		lmt syscall.Rlimit
	)

	if testingDataDir, err = os.MkdirTemp("", "EQLite"); err != nil {
		panic(err)
	}


	if runtime.GOOS == "linux" {
		if err = syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lmt); err != nil {
			panic(err)
		}
		if lmt.Max < minNoFile {
			panic("insufficient max RLIMIT_NOFILE")
		}
		lmt.Cur = lmt.Max
		if err = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &lmt); err != nil {
			panic(err)
		}
	}

	log.SetOutput(os.Stdout)
	log.SetLevel(log.DebugLevel)
}

func teardown() {
	if err := os.RemoveAll(testingDataDir); err != nil {
		panic(err)
	}
}

func TestMain(m *testing.M) {
	os.Exit(func() int {
		setup()
		defer teardown()
		return m.Run()
	}())
}
