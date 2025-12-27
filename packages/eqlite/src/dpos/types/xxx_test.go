
package types

import (
	"os"
	"testing"

	"eqlite/src/utils/log"
)

func setup() {
	log.SetOutput(os.Stdout)
	log.SetLevel(log.DebugLevel)
}

func teardown() {
}

func TestMain(m *testing.M) {
	os.Exit(func() int {
		setup()
		defer teardown()
		return m.Run()
	}())
}
