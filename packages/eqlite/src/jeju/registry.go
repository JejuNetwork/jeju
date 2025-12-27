/*
 * Copyright 2024-2025 Jeju Network.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package jeju

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"eqlite/src/proto"
	"eqlite/src/utils/log"
)

// NodeRole represents the role of an EQLite node.
type NodeRole uint8

const (
	// RoleBlockProducer is a block producer node.
	RoleBlockProducer NodeRole = 0
	// RoleMiner is a miner node.
	RoleMiner NodeRole = 1
)

// NodeStatus represents the status of an EQLite node.
type NodeStatus uint8

const (
	// StatusPending is awaiting attestation.
	StatusPending NodeStatus = 0
	// StatusActive is fully operational.
	StatusActive NodeStatus = 1
	// StatusSuspended is temporarily offline.
	StatusSuspended NodeStatus = 2
	// StatusSlashed is penalized for misbehavior.
	StatusSlashed NodeStatus = 3
	// StatusExiting is in unbonding period.
	StatusExiting NodeStatus = 4
)

// EQLiteNode represents on-chain node info from EQLiteRegistry.
type EQLiteNode struct {
	Operator      common.Address
	NodeID        [32]byte
	Role          NodeRole
	Status        NodeStatus
	StakedAmount  *big.Int
	RegisteredAt  *big.Int
	LastHeartbeat *big.Int
	Endpoint      string
	DatabaseCount *big.Int
	TotalQueries  *big.Int
	SlashedAmount *big.Int
}

// DatabaseInfo represents on-chain database info.
type DatabaseInfo struct {
	DatabaseID   [32]byte
	Owner        common.Address
	MinerNodeIDs [][32]byte
	CreatedAt    *big.Int
	Active       bool
}

// RegistryClient provides interface to the EQLiteRegistry contract.
type RegistryClient struct {
	client          *ethclient.Client
	registryAddress common.Address
}

// NewRegistryClient creates a new registry client.
func NewRegistryClient(rpcEndpoint string, registryAddress string) (*RegistryClient, error) {
	client, err := ethclient.Dial(rpcEndpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to ETH RPC: %w", err)
	}

	return &RegistryClient{
		client:          client,
		registryAddress: common.HexToAddress(registryAddress),
	}, nil
}

// Close closes the client connection.
func (r *RegistryClient) Close() {
	r.client.Close()
}

// GetNode retrieves node information from the registry.
func (r *RegistryClient) GetNode(ctx context.Context, nodeID [32]byte) (*EQLiteNode, error) {
	// Call the getNode function on the contract
	// This is a placeholder - actual implementation would use generated bindings
	log.WithField("nodeID", common.Bytes2Hex(nodeID[:])).Debug("getting node from registry")

	// TODO: Implement actual contract call using generated bindings
	return nil, fmt.Errorf("not implemented - requires contract bindings")
}

// IsNodeHealthy checks if a node is healthy based on heartbeat.
func (r *RegistryClient) IsNodeHealthy(ctx context.Context, nodeID [32]byte) (bool, error) {
	log.WithField("nodeID", common.Bytes2Hex(nodeID[:])).Debug("checking node health")

	// TODO: Implement actual contract call
	return false, fmt.Errorf("not implemented - requires contract bindings")
}

// GetActiveMiners returns all active miner node IDs.
func (r *RegistryClient) GetActiveMiners(ctx context.Context) ([][32]byte, error) {
	log.Debug("getting active miners from registry")

	// TODO: Implement actual contract call
	return nil, fmt.Errorf("not implemented - requires contract bindings")
}

// GetActiveBlockProducers returns all active block producer node IDs.
func (r *RegistryClient) GetActiveBlockProducers(ctx context.Context) ([][32]byte, error) {
	log.Debug("getting active block producers from registry")

	// TODO: Implement actual contract call
	return nil, fmt.Errorf("not implemented - requires contract bindings")
}

// GetDatabaseInfo retrieves database information from the registry.
func (r *RegistryClient) GetDatabaseInfo(ctx context.Context, databaseID [32]byte) (*DatabaseInfo, error) {
	log.WithField("databaseID", common.Bytes2Hex(databaseID[:])).Debug("getting database info from registry")

	// TODO: Implement actual contract call
	return nil, fmt.Errorf("not implemented - requires contract bindings")
}

// RegisterNode registers a new node with the registry.
func (r *RegistryClient) RegisterNode(
	ctx context.Context,
	opts *bind.TransactOpts,
	nodeID [32]byte,
	role NodeRole,
	endpoint string,
	stakeAmount *big.Int,
) error {
	log.WithFields(log.Fields{
		"nodeID":      common.Bytes2Hex(nodeID[:]),
		"role":        role,
		"endpoint":    endpoint,
		"stakeAmount": stakeAmount.String(),
	}).Info("registering node with registry")

	// TODO: Implement actual contract call
	return fmt.Errorf("not implemented - requires contract bindings")
}

// SubmitAttestation submits TEE attestation to activate a node.
func (r *RegistryClient) SubmitAttestation(
	ctx context.Context,
	opts *bind.TransactOpts,
	nodeID [32]byte,
	attestation []byte,
	mrEnclave [32]byte,
) error {
	log.WithField("nodeID", common.Bytes2Hex(nodeID[:])).Info("submitting attestation")

	// TODO: Implement actual contract call
	return fmt.Errorf("not implemented - requires contract bindings")
}

// Heartbeat sends a heartbeat to prove node is online.
func (r *RegistryClient) Heartbeat(
	ctx context.Context,
	opts *bind.TransactOpts,
	nodeID [32]byte,
	queryCount *big.Int,
) error {
	log.WithFields(log.Fields{
		"nodeID":     common.Bytes2Hex(nodeID[:]),
		"queryCount": queryCount.String(),
	}).Debug("sending heartbeat")

	// TODO: Implement actual contract call
	return fmt.Errorf("not implemented - requires contract bindings")
}

// CreateDatabase creates a new database in the registry.
func (r *RegistryClient) CreateDatabase(
	ctx context.Context,
	opts *bind.TransactOpts,
	databaseID [32]byte,
	minerNodeIDs [][32]byte,
) error {
	log.WithFields(log.Fields{
		"databaseID": common.Bytes2Hex(databaseID[:]),
		"minerCount": len(minerNodeIDs),
	}).Info("creating database in registry")

	// TODO: Implement actual contract call
	return fmt.Errorf("not implemented - requires contract bindings")
}

// NodeIDToBytes32 converts a proto.NodeID to [32]byte.
func NodeIDToBytes32(nodeID proto.NodeID) [32]byte {
	var result [32]byte
	copy(result[:], []byte(nodeID))
	return result
}

// DatabaseIDToBytes32 converts a proto.DatabaseID to [32]byte.
func DatabaseIDToBytes32(dbID proto.DatabaseID) [32]byte {
	var result [32]byte
	copy(result[:], []byte(dbID))
	return result
}

// Bytes32ToNodeID converts [32]byte to proto.NodeID.
func Bytes32ToNodeID(b [32]byte) proto.NodeID {
	return proto.NodeID(string(b[:]))
}

// Bytes32ToDatabaseID converts [32]byte to proto.DatabaseID.
func Bytes32ToDatabaseID(b [32]byte) proto.DatabaseID {
	return proto.DatabaseID(string(b[:]))
}
