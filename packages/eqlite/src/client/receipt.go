
package client

import (
	"context"
	"sync/atomic"

	"eqlite/src/crypto/hash"
)

var (
	ctxReceiptKey = "_eqlite_receipt"
)

// Receipt defines a receipt of EQLite query request.
type Receipt struct {
	RequestHash hash.Hash
}

// WithReceipt returns a context who holds a *atomic.Value. A *Receipt will be set to this value
// after the query succeeds.
//
// Note that this context is safe for concurrent queries, but the value may be reset in another
// goroutines. So if you want to make use of Receipt in several goroutines, you should call this
// method to get separated child context in each goroutine.
func WithReceipt(ctx context.Context) context.Context {
	var value atomic.Value
	value.Store((*Receipt)(nil))
	return context.WithValue(ctx, &ctxReceiptKey, &value)
}

// GetReceipt tries to get *Receipt from context.
func GetReceipt(ctx context.Context) (rec *Receipt, ok bool) {
	vali := ctx.Value(&ctxReceiptKey)
	if vali == nil {
		return
	}
	value, ok := vali.(*atomic.Value)
	if !ok {
		return
	}
	reci := value.Load()
	rec, ok = reci.(*Receipt)
	if rec == nil {
		ok = false
	}
	return
}
