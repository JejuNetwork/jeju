
package storage

import (
	"testing"
)

func TestDSN(t *testing.T) {
	testStrings := []string{
		"",
		"file:test.db",
		"file::memory:?cache=shared&mode=memory",
		"file:test.db?p1=v1&p2=v2&p1=v3",
	}

	for _, s := range testStrings {
		dsn, err := NewDSN(s)

		if err != nil {
			t.Errorf("error occurred: %v", err)
			continue
		}

		t.Logf("Test format: string = %s, formatted = %s", s, dsn.Format())

		dsn.SetFileName("file:/dev/null")
		t.Logf("Test set file name: formatted = %s", dsn.Format())

		dsn.AddParam("key", "value")
		t.Logf("Test set add param: formatted = %s", dsn.Format())

		dsn.AddParam("key", "")
		t.Logf("Test delete param by set empty to add param: formatted = %s", dsn.Format())
		if _, ok := dsn.GetParam("key"); ok {
			t.Errorf("Should not have deleted key")
		}
	}

	invalidString1 := "file:test.db?p1"
	dsn, err := NewDSN(invalidString1)
	if err == nil {
		t.Errorf("Should occurred unrecognized parameter error: %v", dsn)
	}

	dsn = &DSN{}
	dsn.AddParam("clone", "true")
	clone := dsn.Clone()
	if _, ok := clone.GetParam("clone"); !ok {
		t.Errorf("Should cloned params")
	}
}
