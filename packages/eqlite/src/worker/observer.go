
package worker

import (
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/types"
	"eqlite/src/utils/log"
)

// ObserverFetchBlock handles observer fetch block logic.
func (rpc *DBMSRPCService) ObserverFetchBlock(req *ObserverFetchBlockReq, resp *ObserverFetchBlockResp) (err error) {
	subscriberID := req.GetNodeID().ToNodeID()
	resp.Block, resp.Count, err = rpc.dbms.observerFetchBlock(req.DatabaseID, subscriberID, req.Count)
	return
}

func (dbms *DBMS) observerFetchBlock(dbID proto.DatabaseID, nodeID proto.NodeID, count int32) (
	block *types.Block, realCount int32, err error) {
	var (
		pubKey *asymmetric.PublicKey
		addr   proto.AccountAddress
		height int32
	)

	// node parameters
	pubKey, err = kms.GetPublicKey(nodeID)
	if err != nil {
		log.WithFields(log.Fields{
			"databaseID": dbID,
			"nodeID":     nodeID,
		}).WithError(err).Warning("get public key failed in observerFetchBlock")
		return
	}

	addr, err = crypto.PubKeyHash(pubKey)
	if err != nil {
		log.WithFields(log.Fields{
			"databaseID": dbID,
			"nodeID":     nodeID,
		}).WithError(err).Warning("generate addr failed in observerFetchBlock")
		return
	}

	defer func() {
		lf := log.WithFields(log.Fields{
			"dbID":   dbID,
			"nodeID": nodeID,
			"addr":   addr.String(),
			"count":  count,
		})

		if err != nil {
			lf.WithError(err).Debug("observer fetch block")
		} else {
			if block != nil {
				lf = lf.WithField("block", block.BlockHash())
			}
			lf.WithField("height", height).Debug("observer fetch block")
		}
	}()

	// check permission
	err = dbms.checkPermission(addr, dbID, types.ReadQuery, nil)
	if err != nil {
		log.WithFields(log.Fields{
			"databaseID": dbID,
			"addr":       addr,
		}).WithError(err).Warning("permission deny")
		return
	}

	rawDB, ok := dbms.dbMap.Load(dbID)
	if !ok {
		err = ErrNotExists
		return
	}
	db := rawDB.(*Database)
	block, realCount, height, err = db.chain.FetchBlockByCount(count)
	return
}
