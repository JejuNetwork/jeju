
package proto

import (
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
)

//go:generate hsp

// PeersHeader defines the header for miner peers.
type PeersHeader struct {
	Version uint64
	Term    uint64
	Leader  NodeID
	Servers []NodeID
}

// Peers defines the peers configuration.
type Peers struct {
	PeersHeader
	verifier.DefaultHashSignVerifierImpl
}

// Clone makes a deep copy of Peers.
func (p *Peers) Clone() (copy Peers) {
	copy.Version = p.Version
	copy.Term = p.Term
	copy.Leader = p.Leader
	copy.Servers = append(copy.Servers, p.Servers...)
	copy.DefaultHashSignVerifierImpl = p.DefaultHashSignVerifierImpl
	return
}

// Sign generates signature.
func (p *Peers) Sign(signer *asymmetric.PrivateKey) (err error) {
	return p.DefaultHashSignVerifierImpl.Sign(&p.PeersHeader, signer)
}

// Verify verify signature.
func (p *Peers) Verify() (err error) {
	return p.DefaultHashSignVerifierImpl.Verify(&p.PeersHeader)
}

// Find finds the index of the server with the specified key in the server list.
func (p *Peers) Find(key NodeID) (index int32, found bool) {
	if p.Servers != nil {
		for i, s := range p.Servers {
			if key.IsEqual(&s) {
				index = int32(i)
				found = true
				break
			}
		}
	}

	return
}
