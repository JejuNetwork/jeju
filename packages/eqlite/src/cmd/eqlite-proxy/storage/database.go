
package storage

import (
	"database/sql"

	"github.com/pkg/errors"
	gorp "gopkg.in/gorp.v2"

	"eqlite/src/client"
	"eqlite/src/cmd/eqlite-proxy/config"
)

// NewDatabase returns new project database object based on storage config.
func NewDatabase(cfg *config.StorageConfig) (storage *gorp.DbMap, err error) {
	var db *sql.DB

	if cfg == nil {
		// using test database
		db, err = sql.Open("sqlite3", "file::memory:?mode=memory&cache=shared")
	} else if cfg.UseLocalDatabase {
		db, err = sql.Open("sqlite3", cfg.DatabaseID)
	} else {
		dsnCfg := client.NewConfig()
		dsnCfg.DatabaseID = cfg.DatabaseID
		db, err = sql.Open("eqlite", dsnCfg.FormatDSN())
	}

	if err != nil {
		err = errors.Wrapf(err, "open proxy database failed")
		return
	}

	storage = &gorp.DbMap{Db: db, Dialect: gorp.SqliteDialect{}}
	return
}
