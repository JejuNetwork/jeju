package proto

import (
	"encoding/json"
)

// MarshalHash marshals PeersHeader for hash computation
func (p *PeersHeader) MarshalHash() ([]byte, error) {
	return json.Marshal(p)
}

// Msgsize returns an upper bound estimate of the number of bytes
func (p *PeersHeader) Msgsize() int {
	// Estimate: version(9) + term(9) + leader(32) + servers(variable)
	return 50 + len(p.Servers)*32
}

