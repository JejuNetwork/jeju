
package client

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestStmt(t *testing.T) {
	if os.Getenv("EQLITE_INTEGRATION_TEST") != "1" {
		t.Skip("Skipping integration test: set EQLITE_INTEGRATION_TEST=1 to run")
	}
	Convey("test statement", t, func() {
		var stopTestService func()
		var err error
		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()

		var db *sql.DB
		db, err = sql.Open("eqlite", "eqlite://db")
		So(db, ShouldNotBeNil)
		So(err, ShouldBeNil)

		_, err = db.Exec("create table test (test int)")
		So(err, ShouldBeNil)
		_, err = db.Exec("insert into test values (1)")
		So(err, ShouldBeNil)

		var stmt *sql.Stmt
		stmt, err = db.Prepare("select count(1) as cnt from test where test = ?")
		So(err, ShouldBeNil)
		So(stmt, ShouldNotBeNil)

		var row *sql.Row
		var result int

		// query with argument 1
		row = stmt.QueryRow(1)
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 1)

		// query with argument 2
		row = stmt.QueryRow(2)
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 0)

		// query when statement closed
		stmt.Close()
		row = stmt.QueryRow(1)
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldNotBeNil)

		// exec statement
		stmt, err = db.Prepare("insert into test values(?)")

		// parameter count equals to placeholders
		_, err = stmt.Exec(2)
		So(err, ShouldBeNil)
		row = db.QueryRow("select count(1) as cnt from test")
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 2) // test insert success

		// parameter count is more than placeholders
		_, err = stmt.Exec(3, 4, 5, 6)
		So(err, ShouldBeNil)
		row = db.QueryRow("select count(1) as cnt from test")
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 3)

		// not enough placeholders
		_, err = stmt.Exec()
		So(err, ShouldNotBeNil)

		ctx := context.Background()
		err = ExecuteTx(ctx, db, nil /* txopts */, func(tx *sql.Tx) error {
			_, err := tx.Exec("insert into test values(?)", 7)
			if err != nil {
				return err
			}
			_, err = tx.Exec("insert into test values(?)", 8)
			if err != nil {
				return err
			}
			_, err = tx.Exec("insert into test values(?)", 9)
			if err != nil {
				return err
			}
			return err
		})
		So(err, ShouldBeNil)

		row = db.QueryRow("select count(1) as cnt from test")
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 6)

		err = ExecuteTx(ctx, db, nil /* txopts */, func(tx *sql.Tx) error {
			_, err := tx.Exec("insert into test values(?)", 10)
			if err != nil {
				return err
			}
			_, err = tx.Exec("insert into testNoExist values(?)", 11)
			if err != nil {
				return err
			}
			_, err = tx.Exec("insert into test values(?)", 12)
			if err != nil {
				return err
			}
			return err
		})
		So(err, ShouldNotBeNil)

		err = ExecuteTx(ctx, db, nil /* txopts */, func(tx *sql.Tx) error {
			_, err := tx.Exec("insert into test values(?)", 10)
			if err != nil {
				return err
			}
			return fmt.Errorf("some error")
		})
		So(err, ShouldNotBeNil)

		row = db.QueryRow("select count(1) as cnt from test")
		So(row, ShouldNotBeNil)
		err = row.Scan(&result)
		So(err, ShouldBeNil)
		So(result, ShouldEqual, 6)

		db.Close()

		// prepare on closed
		_, err = db.Prepare("select * from test")
		So(err, ShouldNotBeNil)

		err = ExecuteTx(context.TODO(), db, nil /* txopts */, func(tx *sql.Tx) error {
			return nil
		})
		So(err, ShouldNotBeNil)

		// closed stmt and old args
		cs := newStmt(nil, "test query")
		cs.Close()

		_, err = cs.Query([]driver.Value{1})
		So(err, ShouldNotBeNil)

		_, err = cs.Exec([]driver.Value{2})
		err = ExecuteTx(context.TODO(), db, nil /* txopts */, func(tx *sql.Tx) error {
			return nil
		})
		So(err, ShouldNotBeNil)
	})
}
