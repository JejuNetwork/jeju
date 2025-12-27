
package utils

import (
	"bytes"
	"fmt"
	"os"
)

// DupConf duplicate conf file using random new listen addr to avoid failure on concurrent test cases.
func DupConf(confFile string, newConfFile string) (err error) {
	// replace port in confFile
	var fileBytes []byte
	if fileBytes, err = os.ReadFile(confFile); err != nil {
		return
	}

	var ports []int
	if ports, err = GetRandomPorts("127.0.0.1", 4000, 6000, 1); err != nil {
		return
	}

	newConfBytes := bytes.Replace(fileBytes, []byte(":2230"), []byte(fmt.Sprintf(":%v", ports[0])), -1)

	return os.WriteFile(newConfFile, newConfBytes, 0644)
}
