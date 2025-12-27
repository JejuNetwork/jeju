
// Package kms implements Key Management System
// According the best practices from "sections 3.5 and 3.6 of the PCI DSS standard"
// and "ANSI X9.17 - Financial Institution Key Management". we store a Elliptic Curve
// Master Key as the "Key Encrypting Key". The KEK is used to encrypt/decrypt and sign
// the PrivateKey which will be use with ECDH to generate Data Encrypting Key.
package kms
