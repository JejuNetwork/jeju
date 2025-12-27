
package sqlchain

import (
	"sync"

	"eqlite/src/proto"
	rpc "eqlite/src/rpc/mux"
)

// MuxService defines multiplexing service of sql-chain.
type MuxService struct {
	ServiceName string
	serviceMap  sync.Map
}

// NewMuxService creates a new multiplexing service and registers it to rpc server.
func NewMuxService(serviceName string, server *rpc.Server) (service *MuxService, err error) {
	service = &MuxService{
		ServiceName: serviceName,
	}

	err = server.RegisterService(serviceName, service)
	return
}

func (s *MuxService) register(id proto.DatabaseID, service *ChainRPCService) {
	s.serviceMap.Store(id, service)
}

func (s *MuxService) unregister(id proto.DatabaseID) {
	s.serviceMap.Delete(id)
}

// MuxAdviseNewBlockReq defines a request of the AdviseNewBlock RPC method.
type MuxAdviseNewBlockReq struct {
	proto.Envelope
	proto.DatabaseID
	AdviseNewBlockReq
}

// MuxAdviseNewBlockResp defines a response of the AdviseNewBlock RPC method.
type MuxAdviseNewBlockResp struct {
	proto.Envelope
	proto.DatabaseID
	AdviseNewBlockResp
}

// MuxFetchBlockReq defines a request of the FetchBlock RPC method.
type MuxFetchBlockReq struct {
	proto.Envelope
	proto.DatabaseID
	FetchBlockReq
}

// MuxFetchBlockResp defines a response of the FetchBlock RPC method.
type MuxFetchBlockResp struct {
	proto.Envelope
	proto.DatabaseID
	FetchBlockResp
}

// AdviseNewBlock is the RPC method to advise a new produced block to the target server.
func (s *MuxService) AdviseNewBlock(req *MuxAdviseNewBlockReq, resp *MuxAdviseNewBlockResp) error {
	if v, ok := s.serviceMap.Load(req.DatabaseID); ok {
		resp.Envelope = req.Envelope
		resp.DatabaseID = req.DatabaseID
		return v.(*ChainRPCService).AdviseNewBlock(&req.AdviseNewBlockReq, &resp.AdviseNewBlockResp)
	}

	return ErrUnknownMuxRequest
}

// FetchBlock is the RPC method to fetch a known block from the target server.
func (s *MuxService) FetchBlock(req *MuxFetchBlockReq, resp *MuxFetchBlockResp) (err error) {
	if v, ok := s.serviceMap.Load(req.DatabaseID); ok {
		resp.Envelope = req.Envelope
		resp.DatabaseID = req.DatabaseID
		return v.(*ChainRPCService).FetchBlock(&req.FetchBlockReq, &resp.FetchBlockResp)
	}

	return ErrUnknownMuxRequest
}
