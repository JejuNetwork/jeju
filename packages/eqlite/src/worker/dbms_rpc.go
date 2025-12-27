
package worker

import (
	"github.com/pkg/errors"
	metrics "github.com/rcrowley/go-metrics"

	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/rpc"
	"eqlite/src/rpc/mux"
	"eqlite/src/types"
)

var (
	dbQuerySuccCounter metrics.Meter
	dbQueryFailCounter metrics.Meter
)

// ObserverFetchBlockReq defines the request for observer to fetch block.
type ObserverFetchBlockReq struct {
	proto.Envelope
	proto.DatabaseID
	Count int32 // sqlchain block serial number since genesis block (0)
}

// ObserverFetchBlockResp defines the response for observer to fetch block.
type ObserverFetchBlockResp struct {
	Count int32 // sqlchain block serial number since genesis block (0)
	Block *types.Block
}

// DBMSRPCService is the rpc endpoint of database management.
type DBMSRPCService struct {
	dbms *DBMS
}

// NewDBMSRPCService returns new dbms rpc service endpoint.
func NewDBMSRPCService(
	serviceName string, server *mux.Server, direct *rpc.Server, dbms *DBMS,
) (
	service *DBMSRPCService,
) {
	service = &DBMSRPCService{
		dbms: dbms,
	}
	server.RegisterService(serviceName, service)
	if direct != nil {
		direct.RegisterService(serviceName, service)
	}

	dbQuerySuccCounter = metrics.NewMeter()
	metrics.Register("db-query-succ", dbQuerySuccCounter)
	dbQueryFailCounter = metrics.NewMeter()
	metrics.Register("db-query-fail", dbQueryFailCounter)

	return
}

// Query rpc, called by client to issue read/write query.
func (rpc *DBMSRPCService) Query(req *types.Request, res *types.Response) (err error) {
	// Just need to verify signature in db.saveAck
	//if err = req.Verify(); err != nil {
	//	dbQueryFailCounter.Mark(1)
	//	return
	//}
	// verify query is sent from the request node
	if req.Envelope.NodeID.String() != string(req.Header.NodeID) {
		// node id mismatch
		err = errors.Wrap(ErrInvalidRequest, "request node id mismatch in query")
		dbQueryFailCounter.Mark(1)
		return
	}

	var r *types.Response
	if r, err = rpc.dbms.Query(req); err != nil {
		dbQueryFailCounter.Mark(1)
		return
	}

	*res = *r
	dbQuerySuccCounter.Mark(1)

	return
}

// Ack rpc, called by client to confirm read request.
func (rpc *DBMSRPCService) Ack(ack *types.Ack, _ *types.AckResponse) (err error) {
	// Just need to verify signature in db.saveAck
	//if err = ack.Verify(); err != nil {
	//	return
	//}
	// verify if ack node is the original ack node
	if ack.Envelope.NodeID.String() != string(ack.Header.Response.Request.NodeID) {
		err = errors.Wrap(ErrInvalidRequest, "request node id mismatch in ack")
		return
	}

	// verification
	err = rpc.dbms.Ack(ack)

	return
}

// Deploy rpc, called by BP to create/drop database and update peers.
func (rpc *DBMSRPCService) Deploy(req *types.UpdateService, _ *types.UpdateServiceResponse) (err error) {
	// verify request node is block producer
	if !route.IsPermitted(&req.Envelope, route.DBSDeploy) {
		err = errors.Wrap(ErrInvalidRequest, "node not permitted for deploy request")
		return
	}

	// verify signature
	if err = req.Verify(); err != nil {
		return
	}

	// create/drop/update
	switch req.Header.Op {
	case types.CreateDB:
		err = rpc.dbms.Create(&req.Header.Instance, true)
	case types.UpdateDB:
		err = rpc.dbms.Update(&req.Header.Instance)
	case types.DropDB:
		err = rpc.dbms.Drop(req.Header.Instance.DatabaseID)
	}

	return
}
