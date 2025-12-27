
package crypto

import (
	"github.com/pkg/errors"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

// PubKeyHash generates the account hash address for specified public key.
func PubKeyHash(pubKey *asymmetric.PublicKey) (addr proto.AccountAddress, err error) {
	if pubKey == nil {
		err = errors.New("nil public key")
		return
	}
	var enc []byte

	if enc, err = pubKey.MarshalHash(); err != nil {
		return
	}

	addr = proto.AccountAddress(hash.THashH(enc))
	return
}
