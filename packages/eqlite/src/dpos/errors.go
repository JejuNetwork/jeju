
package dpos

import (
	"errors"
)

var (
	// ErrMissingParent indicates the parent of the current query attempt is missing.
	ErrMissingParent = errors.New("query missing parent")
	// ErrInvalidRequest indicates the query is invalid.
	ErrInvalidRequest = errors.New("invalid request")
	// ErrQueryConflict indicates the there is a conflict on query replay.
	ErrQueryConflict = errors.New("query conflict")
	// ErrMuxServiceNotFound indicates that the multiplexing service endpoint is not found.
	ErrMuxServiceNotFound = errors.New("mux service not found")
	// ErrStatefulQueryParts indicates query contains stateful query parts.
	ErrStatefulQueryParts = errors.New("query contains stateful query parts")
	// ErrInvalidTableName indicates query contains invalid table name in ddl statement.
	ErrInvalidTableName = errors.New("invalid table name in ddl")
)
