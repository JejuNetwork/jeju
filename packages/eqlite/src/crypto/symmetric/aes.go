
// Package symmetric implements Symmetric Encryption methods.
package symmetric

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"

	"eqlite/src/crypto"
	"eqlite/src/crypto/hash"
)

var (
	// ErrInputSize indicates cipher data size is not expected,
	// maybe data is not encrypted by EncryptWithPassword in this package
	ErrInputSize = errors.New("cipher data size not match")
)

// KeyDerivation does sha256 twice to password.
func KeyDerivation(password []byte, salt []byte) (out []byte) {
	return hash.DoubleHashB(append(password, salt...))
}

// EncryptWithPassword encrypts data with given password, iv will be placed
// at head of cipher data.
func EncryptWithPassword(in, password []byte, salt []byte) (out []byte, err error) {
	// keyE will be 256 bits, so aes.NewCipher(keyE) will return
	// AES-256 Cipher.
	keyE := KeyDerivation(password, salt)
	paddedIn := crypto.AddPKCSPadding(in)
	// IV + padded cipher data
	out = make([]byte, aes.BlockSize+len(paddedIn))

	// as IV length must equal block size, iv length should be 128 bits
	iv := out[:aes.BlockSize]
	if _, err = io.ReadFull(rand.Reader, iv); err != nil {
		return nil, err
	}

	// start encryption, as keyE and iv are generated properly, there should
	// not be any error
	block, _ := aes.NewCipher(keyE)

	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(out[aes.BlockSize:], paddedIn)

	return out, nil
}

// DecryptWithPassword decrypts data with given password.
func DecryptWithPassword(in, password []byte, salt []byte) (out []byte, err error) {
	keyE := KeyDerivation(password, salt)
	// IV + padded cipher data == (n + 1 + 1) * aes.BlockSize
	if len(in)%aes.BlockSize != 0 || len(in)/aes.BlockSize < 2 {
		return nil, ErrInputSize
	}

	// read IV
	iv := in[:aes.BlockSize]

	// start decryption, as keyE and iv are generated properly, there should
	// not be any error
	block, _ := aes.NewCipher(keyE)

	mode := cipher.NewCBCDecrypter(block, iv)
	// same length as cipher data
	plainData := make([]byte, len(in)-aes.BlockSize)
	mode.CryptBlocks(plainData, in[aes.BlockSize:])

	return crypto.RemovePKCSPadding(plainData)
}
