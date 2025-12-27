
package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	// Import sqlite3 manually.
	_ "github.com/mattn/go-sqlite3"
)

// SQLite3Storage defines the sqlite3 database abstraction.
type SQLite3Storage struct {
	rootDir string
}

// NewSQLite3Storage returns the sqlite3 storage abstraction.
func NewSQLite3Storage(rootDir string) (s *SQLite3Storage, err error) {
	if err = os.MkdirAll(rootDir, 0755); err != nil {
		return
	}
	if rootDir, err = filepath.Abs(rootDir); err != nil {
		return
	}
	return &SQLite3Storage{rootDir: rootDir}, nil
}

// Create implements the Storage abstraction interface.
func (s *SQLite3Storage) Create(nodeCnt int) (dbID string, err error) {
	// generate database name
	randBytes := make([]byte, 32)
	if _, err = rand.Read(randBytes); err != nil {
		return
	}
	dbChecksum := sha256.Sum256(randBytes)
	dbID = hex.EncodeToString(dbChecksum[:])
	var dbConn *sql.DB
	if dbConn, err = s.getConn(dbID, false); err != nil {
		return
	}
	defer dbConn.Close()

	return
}

// Drop implements the Storage abstraction interface.
func (s *SQLite3Storage) Drop(dbID string) (err error) {
	dbFile := filepath.Join(s.rootDir, dbID+".db")
	if _, err = os.Stat(dbFile); err != nil {
		return
	}
	os.Remove(dbFile)
	return
}

// Query implements the Storage abstraction interface.
func (s *SQLite3Storage) Query(dbID string, query string, args ...interface{}) (columns []string, types []string, result [][]interface{}, err error) {
	var conn *sql.DB
	if conn, err = s.getConn(dbID, true); err != nil {
		return
	}
	defer conn.Close()

	var tx *sql.Tx
	if tx, err = conn.Begin(); err != nil {
		return
	}
	defer tx.Rollback()

	var rows *sql.Rows
	if rows, err = tx.Query(query, args...); err != nil {
		return
	}
	defer rows.Close()

	if columns, err = rows.Columns(); err != nil {
		return
	}

	var colTypes []*sql.ColumnType

	if colTypes, err = rows.ColumnTypes(); err != nil {
		return
	}

	types = make([]string, len(colTypes))

	for i, c := range colTypes {
		if c != nil {
			types[i] = c.DatabaseTypeName()
		}
	}

	result, err = readAllRows(rows)
	return
}

// Exec implements the Storage abstraction interface.
func (s *SQLite3Storage) Exec(dbID string, query string, args ...interface{}) (affectedRows int64, lastInsertID int64, err error) {
	var conn *sql.DB
	if conn, err = s.getConn(dbID, false); err != nil {
		return
	}
	defer conn.Close()

	var result sql.Result
	result, err = conn.Exec(query, args...)

	affectedRows, _ = result.RowsAffected()
	lastInsertID, _ = result.LastInsertId()

	return
}

func (s *SQLite3Storage) getConn(dbID string, readonly bool) (db *sql.DB, err error) {
	dbFile := filepath.Join(s.rootDir, dbID+".db3")
	dbDSN := fmt.Sprintf("file:%s?_journal_mode=WAL&_synchronous=NORMAL", dbFile)
	if readonly {
		dbDSN += "&mode=ro"
	}

	return sql.Open("sqlite3", dbDSN)
}
