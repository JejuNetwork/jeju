
package types

import (
	"eqlite/src/proto"
)

// LogType defines the log type.
type LogType uint16

const (
	// LogPrepare defines the prepare phase of a commit.
	LogPrepare LogType = iota
	// LogRollback defines the rollback phase of a commit.
	LogRollback
	// LogCommit defines the commit phase of a commit.
	LogCommit
	// LogCheckpoint defines the checkpoint log (created/virtually created by block production or log truncation).
	LogCheckpoint
	// LogBarrier defines barrier log, all open windows should be waiting this operations to complete.
	LogBarrier
	// LogNoop defines noop log.
	LogNoop
)

func (t LogType) String() (s string) {
	switch t {
	case LogPrepare:
		return "LogPrepare"
	case LogRollback:
		return "LogRollback"
	case LogCommit:
		return "LogCommit"
	case LogCheckpoint:
		return "LogCheckpoint"
	case LogBarrier:
		return "LogBarrier"
	case LogNoop:
		return "LogNoop"
	default:
		return "Unknown"
	}
}

// LogHeader defines the checksum header structure.
type LogHeader struct {
	Index      uint64       // log index
	Version    uint64       // log version
	Type       LogType      // log type
	Producer   proto.NodeID // producer node
	DataLength uint64       // data length
}

// Log defines the log data structure.
type Log struct {
	LogHeader
	// Data could be detected and handle decode properly by log layer
	Data []byte
}
