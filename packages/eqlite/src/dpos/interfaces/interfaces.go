
package interfaces

import (
	"database/sql"
)

// Storage is the interface implemented by an object that returns standard *sql.DB as DirtyReader,
// Reader, or Writer and can be closed by Close.
type Storage interface {
	DirtyReader() *sql.DB
	Reader() *sql.DB
	Writer() *sql.DB
	Close() error
}
