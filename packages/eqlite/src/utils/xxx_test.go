
package utils

import (
	"os"
	"testing"

	"eqlite/src/utils/log"
)

func testSetup() {
	log.SetOutput(os.Stdout)
	log.SetLevel(log.DebugLevel)
}

func TestMain(m *testing.M) {
	testSetup()
	os.Exit(m.Run())
}
