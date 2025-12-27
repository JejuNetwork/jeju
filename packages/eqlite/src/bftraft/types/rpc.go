
package types

import "eqlite/src/proto"

// ApplyRequest defines the apply request entity.
type ApplyRequest struct {
	proto.Envelope
	Instance string
	Log      *Log
}

// FetchRequest defines the fetch request entity.
type FetchRequest struct {
	proto.Envelope
	Instance string
	Index    uint64
}

// FetchResponse defines the fetch response entity.
type FetchResponse struct {
	proto.Envelope
	Instance string
	Log      *Log
}
