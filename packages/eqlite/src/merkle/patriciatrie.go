
package merkle

import (
	"errors"

	"github.com/tchap/go-patricia/patricia"

	"eqlite/src/crypto/hash"
)

// Trie is a patricia trie.
type Trie struct {
	trie *patricia.Trie
}

// NewPatricia is patricia construction.
func NewPatricia() *Trie {
	trie := patricia.NewTrie(patricia.MaxPrefixPerNode(16), patricia.MaxChildrenPerSparseNode(17))
	return &Trie{trie}
}

// Insert serializes key into binary and computes its hash,
// then stores the (hash(key), value) into the trie.
func (trie *Trie) Insert(key []byte, value []byte) (inserted bool) {
	hashedKey := hash.HashB(key)

	inserted = trie.trie.Insert(hashedKey, value)
	return
}

// Get returns the value according to the key.
func (trie *Trie) Get(key []byte) ([]byte, error) {
	hashedKey := hash.HashB(key)

	rawValue := trie.trie.Get(hashedKey)
	if rawValue == nil {
		return nil, errors.New("no such key")
	}
	value := rawValue.([]byte)

	return value, nil
}
