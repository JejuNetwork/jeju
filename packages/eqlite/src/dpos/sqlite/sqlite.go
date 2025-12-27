
package sqlite

import (
	"database/sql"
	"encoding/binary"
	"math"
	"time"

	sqlite3 "github.com/mattn/go-sqlite3"

	"eqlite/src/crypto/symmetric"
	"eqlite/src/storage"
	"eqlite/src/utils/log"
)

const (
	serializableDriver = "sqlite3-custom"
	dirtyReadDriver    = "sqlite3-dirty-reader"
)

// Vector helper functions for sqlite-vec compatible operations.

// float32ToBytes converts float32 slice to bytes in little-endian format.
func float32ToBytes(vec []float32) []byte {
	buf := make([]byte, len(vec)*4)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
	}
	return buf
}

// bytesToFloat32 converts bytes to float32 slice.
func bytesToFloat32(buf []byte) []float32 {
	if len(buf)%4 != 0 {
		return nil
	}
	vec := make([]float32, len(buf)/4)
	for i := range vec {
		bits := binary.LittleEndian.Uint32(buf[i*4:])
		vec[i] = math.Float32frombits(bits)
	}
	return vec
}

// vecDistanceL2 calculates Euclidean distance between two vectors.
func vecDistanceL2(a, b []byte) float64 {
	vecA := bytesToFloat32(a)
	vecB := bytesToFloat32(b)
	if len(vecA) != len(vecB) || len(vecA) == 0 {
		return -1
	}
	var sum float64
	for i := range vecA {
		diff := float64(vecA[i]) - float64(vecB[i])
		sum += diff * diff
	}
	return math.Sqrt(sum)
}

// vecDistanceCosine calculates Cosine distance between two vectors.
func vecDistanceCosine(a, b []byte) float64 {
	vecA := bytesToFloat32(a)
	vecB := bytesToFloat32(b)
	if len(vecA) != len(vecB) || len(vecA) == 0 {
		return -1
	}
	var dot, normA, normB float64
	for i := range vecA {
		fA := float64(vecA[i])
		fB := float64(vecB[i])
		dot += fA * fB
		normA += fA * fA
		normB += fB * fB
	}
	if normA == 0 || normB == 0 {
		return 1
	}
	return 1 - (dot / (math.Sqrt(normA) * math.Sqrt(normB)))
}

// vecNormalize normalizes a vector to unit length.
func vecNormalize(data []byte) []byte {
	vec := bytesToFloat32(data)
	if vec == nil {
		return nil
	}
	var norm float64
	for _, v := range vec {
		norm += float64(v) * float64(v)
	}
	norm = math.Sqrt(norm)
	if norm == 0 {
		return data
	}
	result := make([]float32, len(vec))
	for i, v := range vec {
		result[i] = float32(float64(v) / norm)
	}
	return float32ToBytes(result)
}

// vecLength returns the dimension count of a vector.
func vecLength(data []byte) int {
	if len(data)%4 != 0 {
		return 0
	}
	return len(data) / 4
}

func init() {
	encryptFunc := func(in, pass, salt []byte) (out []byte, err error) {
		out, err = symmetric.EncryptWithPassword(in, pass, salt)
		return
	}

	decryptFunc := func(in, pass, salt []byte) (out []byte, err error) {
		out, err = symmetric.DecryptWithPassword(in, pass, salt)
		return
	}

	sleepFunc := func(t int64) int64 {
		log.Info("sqlite func sleep start")
		time.Sleep(time.Duration(t))
		log.Info("sqlite func sleep end")
		return t
	}

	regCustomFunc := func(c *sqlite3.SQLiteConn) (err error) {
		if err = c.RegisterFunc("sleep", sleepFunc, true); err != nil {
			return
		}
		if err = c.RegisterFunc("encrypt", encryptFunc, true); err != nil {
			return
		}
		if err = c.RegisterFunc("decrypt", decryptFunc, true); err != nil {
			return
		}
		// Register vector functions for sqlite-vec compatible operations
		if err = c.RegisterFunc("vec_distance_l2", vecDistanceL2, true); err != nil {
			return
		}
		if err = c.RegisterFunc("vec_distance_cosine", vecDistanceCosine, true); err != nil {
			return
		}
		if err = c.RegisterFunc("vec_normalize", vecNormalize, true); err != nil {
			return
		}
		if err = c.RegisterFunc("vec_length", vecLength, true); err != nil {
			return
		}
		return
	}

	sql.Register(dirtyReadDriver, &sqlite3.SQLiteDriver{
		ConnectHook: func(c *sqlite3.SQLiteConn) (err error) {
			if _, err = c.Exec("PRAGMA read_uncommitted=1", nil); err != nil {
				return
			}
			if err = regCustomFunc(c); err != nil {
				return
			}
			return
		},
	})
	sql.Register(serializableDriver, &sqlite3.SQLiteDriver{
		ConnectHook: func(c *sqlite3.SQLiteConn) (err error) {
			if err = regCustomFunc(c); err != nil {
				return
			}
			return
		},
	})
}

// SQLite3 is the sqlite3 implementation of the dpos/interfaces.Storage interface.
type SQLite3 struct {
	filename    string
	dirtyReader *sql.DB
	reader      *sql.DB
	writer      *sql.DB
}

// NewSqlite returns a new SQLite3 instance attached to filename.
func NewSqlite(filename string) (s *SQLite3, err error) {
	var (
		instance  = &SQLite3{filename: filename}
		shmRODSN  string
		privRODSN string
		shmRWDSN  string
		dsn       *storage.DSN
	)

	if dsn, err = storage.NewDSN(filename); err != nil {
		return
	}

	dsnRO := dsn.Clone()
	dsnRO.AddParam("_journal_mode", "WAL")
	dsnRO.AddParam("_query_only", "on")
	dsnRO.AddParam("cache", "shared")
	shmRODSN = dsnRO.Format()

	dsnPrivRO := dsn.Clone()
	dsnPrivRO.AddParam("_journal_mode", "WAL")
	dsnPrivRO.AddParam("_query_only", "on")
	privRODSN = dsnPrivRO.Format()

	dsnSHMRW := dsn.Clone()
	dsnSHMRW.AddParam("_journal_mode", "WAL")
	dsnSHMRW.AddParam("cache", "shared")
	shmRWDSN = dsnSHMRW.Format()

	if instance.dirtyReader, err = sql.Open(dirtyReadDriver, shmRODSN); err != nil {
		return
	}
	if instance.reader, err = sql.Open(serializableDriver, privRODSN); err != nil {
		return
	}
	if instance.writer, err = sql.Open(serializableDriver, shmRWDSN); err != nil {
		return
	}
	s = instance
	return
}

// DirtyReader implements DirtyReader method of the dpos/interfaces.Storage interface.
func (s *SQLite3) DirtyReader() *sql.DB {
	return s.dirtyReader
}

// Reader implements Reader method of the dpos/interfaces.Storage interface.
func (s *SQLite3) Reader() *sql.DB {
	return s.reader
}

// Writer implements Writer method of the dpos/interfaces.Storage interface.
func (s *SQLite3) Writer() *sql.DB {
	return s.writer
}

// Close implements Close method of the dpos/interfaces.Storage interface.
func (s *SQLite3) Close() (err error) {
	if err = s.dirtyReader.Close(); err != nil {
		return
	}
	if err = s.reader.Close(); err != nil {
		return
	}
	if err = s.writer.Close(); err != nil {
		return
	}
	return
}
