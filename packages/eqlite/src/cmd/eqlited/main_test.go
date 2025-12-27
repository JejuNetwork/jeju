// +build testbinary


package main

import "testing"

func TestMain(m *testing.M) {
	defer m.Run()
	main()
}
