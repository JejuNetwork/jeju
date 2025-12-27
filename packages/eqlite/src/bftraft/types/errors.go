
package types

import "github.com/pkg/errors"

var (
	// ErrNotLeader represents current node is not a peer leader.
	ErrNotLeader = errors.New("not leader")
	// ErrNotFollower represents current node is not a peer follower.
	ErrNotFollower = errors.New("not follower")
	// ErrPrepareTimeout represents timeout failure for prepare operation.
	ErrPrepareTimeout = errors.New("prepare timeout")
	// ErrPrepareFailed represents failure for prepare operation.
	ErrPrepareFailed = errors.New("prepare failed")
	// ErrInvalidLog represents log is invalid.
	ErrInvalidLog = errors.New("invalid log")
	// ErrNotInPeer represents current node does not exists in peer list.
	ErrNotInPeer = errors.New("node not in peer")
	// ErrInvalidConfig represents invalid bftraft runtime config.
	ErrInvalidConfig = errors.New("invalid runtime config")
	// ErrStopped represents runtime not started.
	ErrStopped = errors.New("stopped")
)
