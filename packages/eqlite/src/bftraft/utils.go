
package bftraft

import (
	"encoding/binary"

	kt "eqlite/src/bftraft/types"
)

func (r *Runtime) goFunc(f func()) {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		f()
	}()
}

/// utils
func (r *Runtime) uint64ToBytes(i uint64) (res []byte) {
	res = make([]byte, 8)
	binary.BigEndian.PutUint64(res, i)
	return
}

func (r *Runtime) bytesToUint64(b []byte) (uint64, error) {
	if len(b) < 8 {
		return 0, kt.ErrInvalidLog
	}
	return binary.BigEndian.Uint64(b), nil
}
