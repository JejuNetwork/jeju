
package utils

import (
	"os"
	"path/filepath"
)

// RemoveAll removes files using glob.
func RemoveAll(pattern string) {
	files, err := filepath.Glob(pattern)
	if err != nil {
		return
	}

	for _, file := range files {
		_ = os.RemoveAll(file)
	}
}
