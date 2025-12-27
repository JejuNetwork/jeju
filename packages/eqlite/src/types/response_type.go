
package types

import (
	"time"

	"github.com/pkg/errors"

	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

//go:generate hsp

// ResponseRow defines single row of query response.
type ResponseRow struct {
	Values []interface{}
}

// ResponsePayload defines column names and rows of query response.
type ResponsePayload struct {
	Columns   []string      `json:"c"`
	DeclTypes []string      `json:"t"`
	Rows      []ResponseRow `json:"r"`
}

// ResponseHeader defines a query response header.
type ResponseHeader struct {
	Request         RequestHeader        `json:"r"`
	RequestHash     hash.Hash            `json:"rh"`
	NodeID          proto.NodeID         `json:"id"` // response node id
	Timestamp       time.Time            `json:"t"`  // time in UTC zone
	RowCount        uint64               `json:"c"`  // response row count of payload
	LogOffset       uint64               `json:"o"`  // request log offset
	LastInsertID    int64                `json:"l"`  // insert insert id
	AffectedRows    int64                `json:"a"`  // affected rows
	PayloadHash     hash.Hash            `json:"dh"` // hash of query response payload
	ResponseAccount proto.AccountAddress `json:"aa"` // response account
}

// GetRequestHash returns the request hash.
func (h *ResponseHeader) GetRequestHash() hash.Hash {
	return h.RequestHash
}

// GetRequestTimestamp returns the request timestamp.
func (h *ResponseHeader) GetRequestTimestamp() time.Time {
	return h.Request.Timestamp
}

// SignedResponseHeader defines a signed query response header.
type SignedResponseHeader struct {
	ResponseHeader
	ResponseHash hash.Hash
}

// Hash returns the response header hash.
func (sh *SignedResponseHeader) Hash() hash.Hash {
	return sh.ResponseHash
}

// VerifyHash verify the hash of the response.
func (sh *SignedResponseHeader) VerifyHash() (err error) {
	return errors.Wrap(verifyHash(&sh.ResponseHeader, &sh.ResponseHash),
		"verify response header hash failed")
}

// BuildHash computes the hash of the response header.
func (sh *SignedResponseHeader) BuildHash() (err error) {
	return errors.Wrap(buildHash(&sh.ResponseHeader, &sh.ResponseHash),
		"compute response header hash failed")
}

// Response defines a complete query response.
type Response struct {
	Header  SignedResponseHeader `json:"h"`
	Payload ResponsePayload      `json:"p"`
}

// BuildHash computes the hash of the response.
func (r *Response) BuildHash() (err error) {
	// set rows count
	r.Header.RowCount = uint64(len(r.Payload.Rows))

	// build hash in header
	if err = buildHash(&r.Payload, &r.Header.PayloadHash); err != nil {
		err = errors.Wrap(err, "compute response payload hash failed")
		return
	}

	// compute header hash
	return r.Header.BuildHash()
}

// VerifyHash verify the hash of the response.
func (r *Response) VerifyHash() (err error) {
	if err = verifyHash(&r.Payload, &r.Header.PayloadHash); err != nil {
		err = errors.Wrap(err, "verify response payload hash failed")
		return
	}

	return r.Header.VerifyHash()
}

// Hash returns the response header hash.
func (r *Response) Hash() hash.Hash {
	return r.Header.Hash()
}
