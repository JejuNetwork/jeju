
package main

import "eqlite/src/proto"

// GossipRequest defines the gossip request payload.
type GossipRequest struct {
	proto.Envelope
	Node *proto.Node
	TTL  uint32
}

// GossipService defines the gossip service instance.
type GossipService struct {
	s *KVServer
}

// NewGossipService returns new gossip service.
func NewGossipService(s *KVServer) *GossipService {
	return &GossipService{
		s: s,
	}
}

// SetNode update current node info and broadcast node update request.
func (s *GossipService) SetNode(req *GossipRequest, resp *interface{}) (err error) {
	return s.s.SetNodeEx(req.Node, req.TTL, req.GetNodeID().ToNodeID())
}
