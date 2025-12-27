

// +build darwin dragonfly netbsd openbsd
// +build !noloadavg

package metric

import (
	"errors"
)

// #include <stdlib.h>
import "C"

func getLoad() ([]float64, error) {
	var loadavg [3]C.double
	samples := C.getloadavg(&loadavg[0], 3)
	if samples != 3 {
		return nil, errors.New("failed to get load average")
	}
	return []float64{float64(loadavg[0]), float64(loadavg[1]), float64(loadavg[2])}, nil
}
