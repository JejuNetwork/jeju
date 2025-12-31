package main

import (
	"encoding/hex"
	"fmt"
	"os"
	"sqlit/src/crypto/hash"
	"sqlit/src/crypto/kms"
	"sqlit/src/pow/cpuminer"
	"sqlit/src/proto"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: get-node-info <private_key_file>")
		os.Exit(1)
	}

	keyFile := os.Args[1]
	masterKey := []byte("") // empty master key for testnet

	// Load private key
	privateKey, err := kms.LoadPrivateKey(keyFile, masterKey)
	if err != nil {
		fmt.Printf("Error loading private key: %v\n", err)
		os.Exit(1)
	}

	publicKey := privateKey.PubKey()
	pubKeyHex := hex.EncodeToString(publicKey.Serialize())
	fmt.Printf("PublicKey: %s\n", pubKeyHex)

	// Generate a simple nonce for testing (difficulty 2)
	nonce := cpuminer.Uint256{A: 1, B: 0, C: 0, D: 0}

	// Generate NodeID using just the public key
	nodeHash := hash.THashH(publicKey.Serialize())
	nodeID := proto.NodeID(hex.EncodeToString(nodeHash[:]))
	fmt.Printf("NodeID: %s\n", nodeID)
	fmt.Printf("Nonce:\n  a: %d\n  b: %d\n  c: %d\n  d: %d\n", nonce.A, nonce.B, nonce.C, nonce.D)
}
