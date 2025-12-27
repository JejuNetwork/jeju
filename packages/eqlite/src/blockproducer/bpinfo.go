
package blockproducer

import (
	"fmt"

	"eqlite/src/proto"
)

type blockProducerInfo struct {
	rank   uint32
	total  uint32
	role   string
	nodeID proto.NodeID
}

// String implements fmt.Stringer.
func (i *blockProducerInfo) String() string {
	return fmt.Sprintf("[%d/%d|%s] %s", i.rank+1, i.total, i.role, i.nodeID)
}

func buildBlockProducerInfos(
	localNodeID proto.NodeID, peers *proto.Peers, isAPINode bool,
) (
	localBPInfo *blockProducerInfo, bpInfos []*blockProducerInfo, err error,
) {
	var (
		total = len(peers.PeersHeader.Servers)
		index int32
		found bool
	)

	bpInfos = make([]*blockProducerInfo, total)
	for i, v := range peers.PeersHeader.Servers {
		var role = "F"
		if v == peers.Leader {
			role = "L"
		}
		bpInfos[i] = &blockProducerInfo{
			rank:   uint32(i),
			total:  uint32(total),
			role:   role,
			nodeID: v,
		}
	}

	if isAPINode {
		localBPInfo = &blockProducerInfo{
			rank:   0,
			total:  uint32(total),
			role:   "A",
			nodeID: localNodeID,
		}
		return localBPInfo, bpInfos, nil
	}

	if index, found = peers.Find(localNodeID); !found {
		err = ErrLocalNodeNotFound
		return
	}

	localBPInfo = bpInfos[index]

	return
}
