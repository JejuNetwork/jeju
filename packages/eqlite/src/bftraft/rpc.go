
package bftraft

import (
	"github.com/pkg/errors"

	kt "eqlite/src/bftraft/types"
	"eqlite/src/proto"
)

func (r *Runtime) errorSummary(errs map[proto.NodeID]error) error {
	failNodes := make(map[proto.NodeID]error)

	for s, err := range errs {
		if err != nil {
			failNodes[s] = err
		}
	}

	if len(failNodes) == 0 {
		return nil
	}

	return errors.Wrapf(kt.ErrPrepareFailed, "fail on nodes: %v", failNodes)
}

/// rpc related
func (r *Runtime) applyRPC(l *kt.Log, minCount int) (tracker *rpcTracker) {
	req := &kt.ApplyRequest{
		Instance: r.instanceID,
		Log:      l,
	}

	tracker = newTracker(r, req, minCount)
	tracker.send()

	// TODO(): track this rpc

	// TODO(): log remote errors

	return
}
