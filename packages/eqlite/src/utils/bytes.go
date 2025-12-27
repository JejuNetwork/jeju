
package utils

// ConcatAll concatenate several bytes slice into one.
func ConcatAll(args ...[]byte) []byte {
	var bLen int
	for i := range args {
		bLen += len(args[i])
	}

	key := make([]byte, bLen)
	position := 0
	for i := range args {
		copy(key[position:], args[i])
		position += len(args[i])
	}
	return key
}
