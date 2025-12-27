
package sqlchain

import (
	"eqlite/src/types"
)

// ChainRPCService defines a sql-chain RPC server.
type ChainRPCService struct {
	chain *Chain
}

// AdviseNewBlockReq defines a request of the AdviseNewBlock RPC method.
type AdviseNewBlockReq struct {
	Block *types.Block
	Count int32
}

// AdviseNewBlockResp defines a response of the AdviseNewBlock RPC method.
type AdviseNewBlockResp struct {
}

// FetchBlockReq defines a request of the FetchBlock RPC method.
type FetchBlockReq struct {
	Height int32
}

// FetchBlockResp defines a response of the FetchBlock RPC method.
type FetchBlockResp struct {
	Height int32
	Block  *types.Block
}

// AdviseNewBlock is the RPC method to advise a new produced block to the target server.
func (s *ChainRPCService) AdviseNewBlock(req *AdviseNewBlockReq, resp *AdviseNewBlockResp) (
	err error) {
	s.chain.blocks <- req.Block
	return
}

// FetchBlock is the RPC method to fetch a known block from the target server.
func (s *ChainRPCService) FetchBlock(req *FetchBlockReq, resp *FetchBlockResp) (err error) {
	resp.Height = req.Height
	resp.Block, err = s.chain.FetchBlock(req.Height)
	if err == nil && resp.Block == nil {
		resp.Height = s.chain.getCurrentHeight()
	}
	return
}
