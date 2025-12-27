
package interfaces

import "time"

//go:generate hsp

// TransactionTypeMixin provide type heuristic features to transaction wrapper.
type TransactionTypeMixin struct {
	TxType    TransactionType
	Timestamp time.Time
}

// NewTransactionTypeMixin returns new instance.
func NewTransactionTypeMixin(txType TransactionType) *TransactionTypeMixin {
	return &TransactionTypeMixin{
		TxType:    txType,
		Timestamp: time.Now().UTC(),
	}
}

// ContainsTransactionTypeMixin interface defines interface to detect transaction type mixin.
type ContainsTransactionTypeMixin interface {
	SetTransactionType(TransactionType)
}

// GetTransactionType implements Transaction.GetTransactionType.
func (m *TransactionTypeMixin) GetTransactionType() TransactionType {
	return m.TxType
}

// SetTransactionType is a helper function for derived types.
func (m *TransactionTypeMixin) SetTransactionType(t TransactionType) {
	m.TxType = t
}

// GetTimestamp implements Transaciton.GetTimestamp().
func (m *TransactionTypeMixin) GetTimestamp() time.Time {
	return m.Timestamp
}

// SetTimestamp is a helper function for derived types.
func (m *TransactionTypeMixin) SetTimestamp(t time.Time) {
	m.Timestamp = t
}
