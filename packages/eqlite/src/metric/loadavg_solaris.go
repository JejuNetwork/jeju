

// +build !noloadavg

package metric

import (
	"errors"
)

/*
// Define "__stack_chk_fail" and "__stack_chk_guard" symbols.
#cgo LDFLAGS: -fno-stack-protector -lssp
// Ensure "hrtime_t" is defined for sys/loadavg.h
#include <sys/time.h>
#include <sys/loadavg.h>
*/
import "C"

func getLoad() ([]float64, error) {
	var loadavg [3]C.double
	samples := C.getloadavg(&loadavg[0], 3)
	if samples != 3 {
		return nil, errors.New("failed to get load average")
	}
	return []float64{float64(loadavg[0]), float64(loadavg[1]), float64(loadavg[2])}, nil
}
