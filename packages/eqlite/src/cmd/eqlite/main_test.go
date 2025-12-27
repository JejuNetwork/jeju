// +build testbinary

package main

import (
	"testing"

	"eqlite/src/cmd/eqlite/internal"
)

func TestMain(m *testing.M) {
	internal.AtExit(func() {
		m.Run()
	})
	main()
}
