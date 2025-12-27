// +build !nocpu

package metric

import (
	"runtime"
	"testing"
)

func TestCPU(t *testing.T) {
	var (
		fieldsCount = 5
		times, err  = getDragonFlyCPUTimes()
	)

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(times) == 0 {
		t.Fatal("no cputimes found")
	}

	want := runtime.NumCPU() * fieldsCount
	if len(times) != want {
		t.Fatalf("should have %d cpuTimes: got %d", want, len(times))
	}
}
