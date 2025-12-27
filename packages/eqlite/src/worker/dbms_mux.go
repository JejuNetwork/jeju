
package worker

import (
	"sync"

	"github.com/pkg/errors"

	"eqlite/src/bftraft"
	kt "eqlite/src/bftraft/types"
	"eqlite/src/proto"
	rpc "eqlite/src/rpc/mux"
)

const (
	// DBBftRaftApplyMethodName defines the database bftraft apply rpc method name.
	DBBftRaftApplyMethodName = "Apply"
	// DBBftRaftFetchMethodName defines the database bftraft fetch rpc method name.
	DBBftRaftFetchMethodName = "Fetch"
)

// DBBftRaftMuxService defines a mux service for sqlchain bftraft.
type DBBftRaftMuxService struct {
	serviceName string
	serviceMap  sync.Map
}

// NewDBBftRaftMuxService returns a new bftraft mux service.
func NewDBBftRaftMuxService(serviceName string, server *rpc.Server) (s *DBBftRaftMuxService, err error) {
	s = &DBBftRaftMuxService{
		serviceName: serviceName,
	}
	err = server.RegisterService(serviceName, s)
	return
}

func (s *DBBftRaftMuxService) register(id proto.DatabaseID, rt *bftraft.Runtime) {
	s.serviceMap.Store(id, rt)

}

func (s *DBBftRaftMuxService) unregister(id proto.DatabaseID) {
	s.serviceMap.Delete(id)
}

// Apply handles bftraft apply call.
func (s *DBBftRaftMuxService) Apply(req *kt.ApplyRequest, _ *interface{}) (err error) {
	// call apply to specified bftraft
	// treat req.Instance as DatabaseID
	id := proto.DatabaseID(req.Instance)

	if v, ok := s.serviceMap.Load(id); ok {
		return v.(*bftraft.Runtime).FollowerApply(req.Log)
	}

	return errors.Wrapf(ErrUnknownMuxRequest, "instance %v", req.Instance)
}

// Fetch handles bftraft fetch call.
func (s *DBBftRaftMuxService) Fetch(req *kt.FetchRequest, resp *kt.FetchResponse) (err error) {
	id := proto.DatabaseID(req.Instance)

	if v, ok := s.serviceMap.Load(id); ok {
		var l *kt.Log
		if l, err = v.(*bftraft.Runtime).Fetch(req.GetContext(), req.Index); err == nil {
			resp.Log = l
			resp.Instance = req.Instance
		}
		return
	}

	return errors.Wrapf(ErrUnknownMuxRequest, "instance %v", req.Instance)
}
