// +build testbinary


package main

import (
	"flag"
	"testing"
)

func TestMain(m *testing.M) {
	flag.Parse()
	defer m.Run()
	main()
}
