
package storage

import (
	"database/sql"

	"eqlite/src/client"
)

// EQLiteStorage defines the eqlite database abstraction.
type EQLiteStorage struct {
	mirrorServerAddr string
}

// NewEQLiteStorage returns new eqlite storage handler.
func NewEQLiteStorage(mirrorServerAddr string) (s *EQLiteStorage) {
	s = &EQLiteStorage{mirrorServerAddr: mirrorServerAddr}
	return
}

// Create implements the Storage abstraction interface.
func (s *EQLiteStorage) Create(nodeCnt int) (dbID string, err error) {
	var meta = client.ResourceMeta{}
	meta.Node = uint16(nodeCnt)

	var dsn string
	if _, dsn, err = client.Create(meta); err != nil {
		return
	}

	var cfg *client.Config
	if cfg, err = client.ParseDSN(dsn); err != nil {
		return
	}

	dbID = cfg.DatabaseID
	return
}

// Drop implements the Storage abstraction interface.
func (s *EQLiteStorage) Drop(dbID string) (err error) {
	cfg := client.NewConfig()
	cfg.DatabaseID = dbID
	_, err = client.Drop(cfg.FormatDSN())
	return
}

// Query implements the Storage abstraction interface.
func (s *EQLiteStorage) Query(dbID string, query string, args ...interface{}) (columns []string, types []string, result [][]interface{}, err error) {
	var conn *sql.DB
	if conn, err = s.getConn(dbID); err != nil {
		return
	}
	defer conn.Close()

	var rows *sql.Rows
	if rows, err = conn.Query(query, args...); err != nil {
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
func (s *EQLiteStorage) Exec(dbID string, query string, args ...interface{}) (affectedRows int64, lastInsertID int64, err error) {
	var conn *sql.DB
	if conn, err = s.getConn(dbID); err != nil {
		return
	}
	defer conn.Close()

	var result sql.Result
	result, err = conn.Exec(query, args...)

	if err == nil {
		affectedRows, _ = result.RowsAffected()
		lastInsertID, _ = result.LastInsertId()
	}

	return
}

func (s *EQLiteStorage) getConn(dbID string) (db *sql.DB, err error) {
	cfg := client.NewConfig()
	cfg.DatabaseID = dbID
	if s.mirrorServerAddr != "" {
		cfg.Mirror = s.mirrorServerAddr
	}

	return sql.Open("eqlite", cfg.FormatDSN())
}
