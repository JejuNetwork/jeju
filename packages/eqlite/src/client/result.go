
package client

type execResult struct {
	affectedRows int64
	lastInsertID int64
}

// LastInsertId return last inserted ID.
func (r *execResult) LastInsertId() (int64, error) {
	return r.lastInsertID, nil
}

// RowsAffected return how many rows affected.
func (r *execResult) RowsAffected() (int64, error) {
	return r.affectedRows, nil
}
