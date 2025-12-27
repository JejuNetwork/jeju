
package observer

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"eqlite/src/conf"
	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/utils/log"
	"eqlite/src/worker"
)

type subscribeWorker struct {
	l      sync.Mutex
	s      *Service
	dbID   proto.DatabaseID
	head   int32
	wg     *sync.WaitGroup
	stopCh chan struct{}
}

func newSubscribeWorker(dbID proto.DatabaseID, head int32, s *Service) *subscribeWorker {
	return &subscribeWorker{
		dbID: dbID,
		head: head,
		s:    s,
	}
}

func (w *subscribeWorker) run() {
	defer w.wg.Done()

	// calc next tick
	var nextTick time.Duration

	for {
		select {
		case <-w.stopCh:
			return
		case <-time.After(nextTick):
			if err := w.pull(w.getHead()); err != nil {
				// calc next tick
				nextTick = conf.GConf.SQLChainPeriod
			} else {
				nextTick /= 10
			}
		}
	}
}

func (w *subscribeWorker) pull(count int32) (err error) {
	var (
		req  = new(worker.ObserverFetchBlockReq)
		resp = new(worker.ObserverFetchBlockResp)
		next int32
	)

	defer func() {
		lf := log.WithFields(log.Fields{
			"req_count": count,
			"count":     resp.Count,
		})

		if err != nil {
			lf.WithError(err).Debug("sync block failed")
		} else {
			if resp.Block != nil {
				lf = lf.WithField("block", resp.Block.BlockHash())
			} else {
				lf = lf.WithField("block", nil)
			}
			lf.WithField("next", next).Debug("sync block success")
		}
	}()

	req.DatabaseID = w.dbID
	req.Count = count

	if err = w.s.minerRequest(w.dbID, route.DBSObserverFetchBlock.String(), req, resp); err != nil {
		return
	}

	if resp.Block == nil {
		err = errors.New("nil block, try later")
		return
	}

	if err = w.s.addBlock(w.dbID, count, resp.Block); err != nil {
		return
	}

	if count < 0 {
		next = resp.Count + 1
	} else {
		next = count + 1
	}

	if atomic.CompareAndSwapInt32(&w.head, count, next) {
		// update subscription status to database
		_ = w.s.saveSubscriptionStatus(w.dbID, next)
	}

	return
}

func (w *subscribeWorker) reset(head int32) {
	atomic.StoreInt32(&w.head, head)
	w.start()
}

func (w *subscribeWorker) start() {
	w.l.Lock()
	defer w.l.Unlock()

	// update subscription status to database
	_ = w.s.saveSubscriptionStatus(w.dbID, w.getHead())

	if w.isStopped() {
		w.stopCh = make(chan struct{})
		w.wg = new(sync.WaitGroup)
		w.wg.Add(1)
		go w.run()
	}
}

func (w *subscribeWorker) getHead() int32 {
	return atomic.LoadInt32(&w.head)
}

func (w *subscribeWorker) stop() {
	w.l.Lock()
	defer w.l.Unlock()

	if !w.isStopped() {
		// stop
		close(w.stopCh)
		w.wg.Wait()
	}
}

func (w *subscribeWorker) isStopped() bool {
	if w.stopCh == nil {
		return true
	}

	select {
	case <-w.stopCh:
		return true
	default:
		return false
	}
}
