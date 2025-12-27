
package types

// Wal defines the log storage interface.
type Wal interface {
	// sequential write
	Write(*Log) error
	// sequential read, return io.EOF if there is no more records to read
	Read() (*Log, error)
	// random access
	Get(index uint64) (*Log, error)
}
