
package worker

import (
	"eqlite/src/proto"
)

// DBMSMeta defines the meta structure.
type DBMSMeta struct {
	DBS map[proto.DatabaseID]bool
}

// NewDBMSMeta returns new DBMSMeta struct.
func NewDBMSMeta() (meta *DBMSMeta) {
	return &DBMSMeta{
		DBS: make(map[proto.DatabaseID]bool),
	}
}
