
package dpos

import (
	"sync"
	"sync/atomic"

	"eqlite/src/crypto/hash"
	"eqlite/src/types"
)

// QueryTracker defines an object to track query as a request - response pair.
type QueryTracker struct {
	sync.RWMutex
	Req  *types.Request
	Resp *types.Response
}

// UpdateResp updates response of the QueryTracker within locking scope.
func (q *QueryTracker) UpdateResp(resp *types.Response) {
	q.Lock()
	defer q.Unlock()
	q.Resp = resp
}

// Ready reports whether the query is ready for block producing. It is assumed that all objects
// should be ready shortly.
func (q *QueryTracker) Ready() bool {
	q.RLock()
	defer q.RUnlock()
	return q.Resp != nil
}

type pool struct {
	// Failed queries: hash => Request
	failed map[hash.Hash]*types.Request
	// Succeeded queries and their index
	reads   map[hash.Hash]*QueryTracker
	queries []*QueryTracker
	index   map[uint64]int
	// Atomic counters for stats
	failedRequestCount int32
	trackerCount       int32
}

func newPool() *pool {
	return &pool{
		failed:  make(map[hash.Hash]*types.Request),
		reads:   make(map[hash.Hash]*QueryTracker),
		queries: make([]*QueryTracker, 0),
		index:   make(map[uint64]int),
	}
}

func (p *pool) enqueue(sp uint64, q *QueryTracker) {
	var pos = len(p.queries)
	p.queries = append(p.queries, q)
	p.index[sp] = pos
	atomic.StoreInt32(&p.trackerCount, int32(len(p.queries)))
}

func (p *pool) enqueueRead(q *QueryTracker) {
	// NOTE(leventeliu): this overwrites any request with a same hash
	p.reads[q.Req.Header.Hash()] = q
}

func (p *pool) setFailed(req *types.Request) {
	p.failed[req.Header.Hash()] = req
	atomic.StoreInt32(&p.failedRequestCount, int32(len(p.failed)))
}

func (p *pool) failedList() (reqs []*types.Request) {
	reqs = make([]*types.Request, 0, len(p.failed))
	for _, v := range p.failed {
		reqs = append(reqs, v)
	}
	return
}

func (p *pool) removeFailed(req *types.Request) {
	delete(p.failed, req.Header.Hash())
	atomic.StoreInt32(&p.failedRequestCount, int32(len(p.failed)))
}

func (p *pool) truncate(sp uint64) {
	var (
		pos int
		ok  bool
		ni  map[uint64]int
	)
	if pos, ok = p.index[sp]; !ok {
		return
	}
	// Rebuild index
	ni = make(map[uint64]int)
	for k, v := range p.index {
		if k > sp {
			ni[k] = v - (pos + 1)
		}
	}
	p.index = ni
	p.queries = p.queries[pos+1:]
	atomic.StoreInt32(&p.trackerCount, int32(len(p.queries)))
}
