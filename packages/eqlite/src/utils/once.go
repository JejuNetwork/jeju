
package utils

import (
	"sync"
	"sync/atomic"
)

// Once refactors sync.Once and add Reset support.
type Once struct {
	m    sync.Mutex
	done uint32
}

// Do handles once logic.
func (o *Once) Do(f func()) {
	if atomic.LoadUint32(&o.done) == 1 {
		return
	}
	// Slow-path.
	o.m.Lock()
	defer o.m.Unlock()
	if o.done == 0 {
		defer atomic.StoreUint32(&o.done, 1)
		f()
	}
}

// Reset make the once object to be initialized once again.
func (o *Once) Reset() {
	// directly to slow-path
	o.m.Lock()
	defer o.m.Unlock()
	atomic.StoreUint32(&o.done, 0)
}
