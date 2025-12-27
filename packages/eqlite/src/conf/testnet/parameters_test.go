
package testnet

import (
	"testing"
)

func TestParseTestNetConfig(t *testing.T) {
	var config = GetTestNetConfig()
	if config == nil {
		t.Fatal("testnet config should not be nil")
	}
}
