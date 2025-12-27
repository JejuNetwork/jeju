
package client

import (
	"database/sql/driver"
	"io"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/types"
)

func TestRowsStructure(t *testing.T) {
	Convey("test rows", t, func() {
		r := newRows(&types.Response{
			Payload: types.ResponsePayload{
				Columns: []string{
					"a",
				},
				DeclTypes: []string{
					"int",
				},
				Rows: []types.ResponseRow{
					{
						Values: []interface{}{1},
					},
				},
			},
		})
		columns := r.Columns()
		So(columns, ShouldResemble, []string{"a"})
		So(r.ColumnTypeDatabaseTypeName(0), ShouldEqual, "INT")

		dest := make([]driver.Value, 1)
		err := r.Next(dest)
		So(err, ShouldBeNil)
		So(dest[0], ShouldEqual, 1)
		err = r.Next(dest)
		So(err, ShouldEqual, io.EOF)
		err = r.Close()
		So(err, ShouldBeNil)
		So(r.data, ShouldBeNil)
	})
}
