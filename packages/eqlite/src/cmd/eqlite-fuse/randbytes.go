package main

import (
	"math/rand"
	"time"
)

var randLetters = []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

// NewPseudoRand returns an instance of math/rand.Rand seeded from crypto/rand
// and its seed so we can easily and cheaply generate unique streams of
// numbers. The created object is not safe for concurrent access.
func NewPseudoRand() (*rand.Rand, int64) {
	seed := time.Now().UnixNano()
	return rand.New(rand.NewSource(seed)), seed
}

// RandBytes returns a byte slice of the given length with random
// data.
func RandBytes(r *rand.Rand, size int) []byte {
	if size <= 0 {
		return nil
	}

	arr := make([]byte, size)
	for i := 0; i < len(arr); i++ {
		arr[i] = randLetters[r.Intn(len(randLetters))]
	}
	return arr
}
