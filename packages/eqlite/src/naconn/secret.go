

package naconn

import (
	"sync"

	"github.com/pkg/errors"

	"eqlite/src/conf"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
)

const (
	sharedSecret = `!&\\!qEyey*\cbLc,aKl`
)

var symmetricKeyCache sync.Map

// GetSharedSecretWith gets shared symmetric key with ECDH.
func GetSharedSecretWith(resolver Resolver, nodeID *proto.RawNodeID, isAnonymous bool) (symmetricKey []byte, err error) {
	if isAnonymous {
		//log.Debug("using anonymous ETLS")
		return []byte(sharedSecret), nil
	}

	symmetricKeyI, ok := symmetricKeyCache.Load(nodeID.String())
	if ok {
		symmetricKey, _ = symmetricKeyI.([]byte)
	} else {
		var remotePublicKey *asymmetric.PublicKey
		if route.IsBPNodeID(nodeID) {
			remotePublicKey = kms.BP.PublicKey
		} else if conf.RoleTag[0] == conf.BlockProducerBuildTag[0] {
			remotePublicKey, err = kms.GetPublicKey(proto.NodeID(nodeID.String()))
			if err != nil {
				err = errors.Wrapf(err, "get public key locally failed, node: %s", nodeID)
				return
			}
		} else {
			// if non BP running and key not found, ask BlockProducer
			var nodeInfo *proto.Node
			nodeInfo, err = resolver.ResolveEx(nodeID)
			if err != nil {
				err = errors.Wrapf(err, "get public key failed, node: %s", nodeID)
				return
			}
			remotePublicKey = nodeInfo.PublicKey
		}

		var localPrivateKey *asymmetric.PrivateKey
		localPrivateKey, err = kms.GetLocalPrivateKey()
		if err != nil {
			err = errors.Wrap(err, "get local private key failed")
			return
		}

		symmetricKey = asymmetric.GenECDHSharedSecret(localPrivateKey, remotePublicKey)
		symmetricKeyCache.Store(nodeID.String(), symmetricKey)
		//log.WithFields(log.Fields{
		//	"node":       nodeID.String(),
		//	"remotePub":  fmt.Sprintf("%#x", remotePublicKey.Serialize()),
		//	"sessionKey": fmt.Sprintf("%#x", symmetricKey),
		//}).Debug("generated shared secret")
	}
	//log.Debugf("ECDH for %s Public Key: %x, Private Key: %x Session Key: %x",
	//	nodeID.ToNodeID(), remotePublicKey.Serialize(), localPrivateKey.Serialize(), symmetricKey)
	return
}
