
package client

import (
	"database/sql/driver"
	"io"
	"strings"

	"eqlite/src/types"
)

type rows struct {
	columns []string
	types   []string
	data    []types.ResponseRow
}

func newRows(res *types.Response) *rows {
	return &rows{
		columns: res.Payload.Columns,
		types:   res.Payload.DeclTypes,
		data:    res.Payload.Rows,
	}
}

// Columns implements driver.Rows.Columns method.
func (r *rows) Columns() []string {
	return r.columns[:]
}

// Close implements driver.Rows.Close method.
func (r *rows) Close() error {
	r.data = nil
	return nil
}

// Next implements driver.Rows.Next method.
func (r *rows) Next(dest []driver.Value) error {
	if len(r.data) == 0 {
		return io.EOF
	}

	for i, d := range r.data[0].Values {
		dest[i] = d
	}

	// unshift data
	r.data = r.data[1:]

	return nil
}

// ColumnTypeDatabaseTypeName implements driver.RowsColumnTypeDatabaseTypeName.ColumnTypeDatabaseTypeName method.
func (r *rows) ColumnTypeDatabaseTypeName(index int) string {
	return strings.ToUpper(r.types[index])
}
