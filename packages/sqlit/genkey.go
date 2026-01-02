//go:build ignore

package main

import (
	"fmt"
	"os"
	"sqlit/src/crypto/asymmetric"
	"sqlit/src/crypto/kms"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: genkey <output_file>")
		os.Exit(1)
	}

	keyFile := os.Args[1]
	masterKey := []byte("") // empty master key for testnet

	// Generate new keypair
	privateKey, _, err := asymmetric.GenSecp256k1KeyPair()
	if err != nil {
		fmt.Printf("Error generating key pair: %v\n", err)
		os.Exit(1)
	}

	// Save private key
	err = kms.SavePrivateKey(keyFile, privateKey, masterKey)
	if err != nil {
		fmt.Printf("Error saving private key: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated private key saved to: %s\n", keyFile)
}
