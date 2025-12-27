package client

import (
	"context"
	"database/sql"
	"database/sql/driver"

	"github.com/pkg/errors"
)

// ExecuteTx starts a transaction, and runs fn in it.
func ExecuteTx(
	ctx context.Context, db *sql.DB, txopts *sql.TxOptions, fn func(*sql.Tx) error,
) error {
	// Start a transaction.
	tx, err := db.BeginTx(ctx, txopts)
	if err != nil {
		return err
	}
	return ExecuteInTx(tx, func() error { return fn(tx) })
}

// ExecuteInTx runs fn inside tx which should already have begun.
func ExecuteInTx(tx driver.Tx, fn func() error) (err error) {
	err = fn()
	if err == nil {
		err = tx.Commit()
		if err != nil {
			err = errors.Wrapf(err, "exec in tx")
		}
	} else {
		_ = tx.Rollback()
	}
	return
}
