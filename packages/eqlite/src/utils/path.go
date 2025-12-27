
package utils

import (
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

// CopyFile copies from src to dst until either EOF is reached
// on src or an error occurs. It verifies src exists and removes
// the dst if it exists.
func CopyFile(src, dst string) (int64, error) {
	cleanSrc := filepath.Clean(src)
	cleanDst := filepath.Clean(dst)
	if cleanSrc == cleanDst {
		return 0, nil
	}
	sf, err := os.Open(cleanSrc)
	if err != nil {
		return 0, err
	}
	defer sf.Close()
	if err := os.Remove(cleanDst); err != nil && !os.IsNotExist(err) {
		return 0, err
	}
	df, err := os.Create(cleanDst)
	if err != nil {
		return 0, err
	}
	defer df.Close()
	return io.Copy(df, sf)
}

// HomeDirExpand tries to expand the tilde (~) in the front of a path
// to a fullpath directory.
func HomeDirExpand(path string) string {
	usr, err := user.Current()
	if err != nil {
		return path
	}

	if path == "~" {
		return usr.HomeDir
	} else if strings.HasPrefix(path, "~/") {
		return filepath.Join(usr.HomeDir, strings.TrimPrefix(path, "~/"))
	}

	return path
}

// Exist return if file or path is exist.
func Exist(path string) bool {
	_, err := os.Stat(path)
	return err == nil || os.IsExist(err)
}
