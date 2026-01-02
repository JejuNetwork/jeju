
package main

import (
	"sqlit/src/conf"
	"sqlit/src/crypto/hash"
	"sqlit/src/crypto/kms"
	"sqlit/src/proto"
	"sqlit/src/route"
	"sqlit/src/utils/log"
)

func initNodePeers(nodeID proto.NodeID, publicKeystorePath string) (nodes *[]proto.Node, peers *proto.Peers, thisNode *proto.Node, err error) {
	privateKey, err := kms.GetLocalPrivateKey()
	if err != nil {
		log.WithError(err).Fatal("get local private key failed")
	}

	peers = &proto.Peers{
		PeersHeader: proto.PeersHeader{
			Term:   1,
			Leader: conf.GConf.BP.NodeID,
		},
	}

	if conf.GConf.KnownNodes != nil {
		for i, n := range conf.GConf.KnownNodes {
			if n.Role == proto.Leader || n.Role == proto.Follower {
				//FIXME all KnownNodes
				conf.GConf.KnownNodes[i].PublicKey = kms.BP.PublicKey
				peers.Servers = append(peers.Servers, n.ID)
			}
		}
	}

	log.Debugf("AllNodes:\n %#v\n", conf.GConf.KnownNodes)

	err = peers.Sign(privateKey)
	if err != nil {
		log.WithError(err).Error("sign peers failed")
		return nil, nil, nil, err
	}
	log.Debugf("peers:\n %#v\n", peers)

	//route.initResolver()
	if initErr := kms.InitPublicKeyStore(publicKeystorePath, nil); initErr != nil {
		log.WithError(initErr).Error("init public key store failed")
	}

	// set p route and public keystore
	if conf.GConf.KnownNodes != nil {
		for i, p := range conf.GConf.KnownNodes {
			rawNodeIDHash, err := hash.NewHashFromStr(string(p.ID))
			if err != nil {
				log.WithError(err).Error("load hash from node id failed")
				return nil, nil, nil, err
			}
			log.WithFields(log.Fields{
				"node": rawNodeIDHash.String(),
				"addr": p.Addr,
			}).Debug("set node addr")
			rawNodeID := &proto.RawNodeID{Hash: *rawNodeIDHash}
			if cacheErr := route.SetNodeAddrCache(rawNodeID, p.Addr); cacheErr != nil {
				log.WithError(cacheErr).Debug("set node addr cache failed")
			}
			node := &proto.Node{
				ID:         p.ID,
				Addr:       p.Addr,
				DirectAddr: p.DirectAddr,
				PublicKey:  p.PublicKey,
				Nonce:      p.Nonce,
				Role:       p.Role,
			}
			err = kms.SetNode(node)
			if err != nil {
				log.WithField("node", node).WithError(err).Error("set node failed")
			}
			if p.ID == nodeID {
				kms.SetLocalNodeIDNonce(rawNodeID.CloneBytes(), &p.Nonce)
				thisNode = &conf.GConf.KnownNodes[i]
			}
		}
	}

	return
}
