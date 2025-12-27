
package asymmetric

import ec "github.com/btcsuite/btcd/btcec"

// GenECDHSharedSecret is just a wrapper of ec.GenerateSharedSecret which
// generates a shared secret based on a private key and a
// public key using Diffie-Hellman key exchange (ECDH) (RFC 4753).
// RFC5903 Section 9 states we should only return x.
// Key Feature:
// 		GenECDHSharedSecret(BPub, APriv) == GenECDHSharedSecret(APub, BPriv).
func GenECDHSharedSecret(privateKey *PrivateKey, publicKey *PublicKey) []byte {
	return ec.GenerateSharedSecret((*ec.PrivateKey)(privateKey), (*ec.PublicKey)(publicKey))
}
