package types

import (
	"encoding/json"
)

// MarshalHash marshals BlockHeader for hash computation
func (h *BlockHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *BlockHeader) Msgsize() int                 { return 512 }

