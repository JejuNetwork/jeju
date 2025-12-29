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
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// EQLiteRegistryABI is the input ABI used to generate the binding from.
const EQLiteRegistryABI = `[
	{
		"inputs": [{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"}],
		"name": "getNode",
		"outputs": [
			{
				"components": [
					{"internalType": "address", "name": "operator", "type": "address"},
					{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"},
					{"internalType": "uint8", "name": "role", "type": "uint8"},
					{"internalType": "uint8", "name": "status", "type": "uint8"},
					{"internalType": "uint256", "name": "stakedAmount", "type": "uint256"},
					{"internalType": "uint256", "name": "registeredAt", "type": "uint256"},
					{"internalType": "uint256", "name": "lastHeartbeat", "type": "uint256"},
					{"internalType": "string", "name": "endpoint", "type": "string"},
					{"internalType": "bytes", "name": "teeAttestation", "type": "bytes"},
					{"internalType": "bytes32", "name": "mrEnclave", "type": "bytes32"},
					{"internalType": "uint256", "name": "databaseCount", "type": "uint256"},
					{"internalType": "uint256", "name": "totalQueries", "type": "uint256"},
					{"internalType": "uint256", "name": "slashedAmount", "type": "uint256"}
				],
				"internalType": "struct EQLiteRegistry.EQLiteNode",
				"name": "",
				"type": "tuple"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"}],
		"name": "isNodeHealthy",
		"outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getActiveMiners",
		"outputs": [{"internalType": "bytes32[]", "name": "", "type": "bytes32[]"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "getActiveBlockProducers",
		"outputs": [{"internalType": "bytes32[]", "name": "", "type": "bytes32[]"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "bytes32", "name": "databaseId", "type": "bytes32"}],
		"name": "getDatabaseInfo",
		"outputs": [
			{
				"components": [
					{"internalType": "bytes32", "name": "databaseId", "type": "bytes32"},
					{"internalType": "address", "name": "owner", "type": "address"},
					{"internalType": "bytes32[]", "name": "minerNodeIds", "type": "bytes32[]"},
					{"internalType": "uint256", "name": "createdAt", "type": "uint256"},
					{"internalType": "bool", "name": "active", "type": "bool"}
				],
				"internalType": "struct EQLiteRegistry.DatabaseInfo",
				"name": "",
				"type": "tuple"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"},
			{"internalType": "uint8", "name": "role", "type": "uint8"},
			{"internalType": "string", "name": "endpoint", "type": "string"},
			{"internalType": "uint256", "name": "stakeAmount", "type": "uint256"}
		],
		"name": "registerNode",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"},
			{"internalType": "bytes", "name": "attestation", "type": "bytes"},
			{"internalType": "bytes32", "name": "mrEnclave", "type": "bytes32"}
		],
		"name": "submitAttestation",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{"internalType": "bytes32", "name": "nodeId", "type": "bytes32"},
			{"internalType": "uint256", "name": "queryCount", "type": "uint256"}
		],
		"name": "heartbeat",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{"internalType": "bytes32", "name": "databaseId", "type": "bytes32"},
			{"internalType": "bytes32[]", "name": "minerNodeIds", "type": "bytes32[]"}
		],
		"name": "createDatabase",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	}
]`

// EQLiteRegistryCaller is an auto generated read-only Go binding around an Ethereum contract.
type EQLiteRegistryCaller struct {
	contract *bind.BoundContract
}

// EQLiteRegistryTransactor is an auto generated write-only Go binding around an Ethereum contract.
type EQLiteRegistryTransactor struct {
	contract *bind.BoundContract
}

// EQLiteRegistrySession combines caller and transactor for session-based interaction.
type EQLiteRegistrySession struct {
	Contract     *EQLiteRegistry
	CallOpts     bind.CallOpts
	TransactOpts bind.TransactOpts
}

// EQLiteRegistry is a binding to the EQLiteRegistry contract.
type EQLiteRegistry struct {
	EQLiteRegistryCaller
	EQLiteRegistryTransactor
	address common.Address
}

// NewEQLiteRegistry creates a new instance of EQLiteRegistry bound to a specific address.
func NewEQLiteRegistry(address common.Address, backend bind.ContractBackend) (*EQLiteRegistry, error) {
	parsed, err := abi.JSON(strings.NewReader(EQLiteRegistryABI))
	if err != nil {
		return nil, err
	}

	contract := bind.NewBoundContract(address, parsed, backend, backend, backend)

	return &EQLiteRegistry{
		EQLiteRegistryCaller:     EQLiteRegistryCaller{contract: contract},
		EQLiteRegistryTransactor: EQLiteRegistryTransactor{contract: contract},
		address:                  address,
	}, nil
}

// Address returns the contract address.
func (e *EQLiteRegistry) Address() common.Address {
	return e.address
}

// GetNode retrieves node information from the registry.
func (c *EQLiteRegistryCaller) GetNode(opts *bind.CallOpts, nodeId [32]byte) (*EQLiteNode, error) {
	var out []interface{}
	err := c.contract.Call(opts, &out, "getNode", nodeId)
	if err != nil {
		return nil, err
	}

	// Parse the result struct
	result := out[0].(struct {
		Operator       common.Address
		NodeId         [32]byte
		Role           uint8
		Status         uint8
		StakedAmount   *big.Int
		RegisteredAt   *big.Int
		LastHeartbeat  *big.Int
		Endpoint       string
		TeeAttestation []byte
		MrEnclave      [32]byte
		DatabaseCount  *big.Int
		TotalQueries   *big.Int
		SlashedAmount  *big.Int
	})

	return &EQLiteNode{
		Operator:      result.Operator,
		NodeID:        result.NodeId,
		Role:          NodeRole(result.Role),
		Status:        NodeStatus(result.Status),
		StakedAmount:  result.StakedAmount,
		RegisteredAt:  result.RegisteredAt,
		LastHeartbeat: result.LastHeartbeat,
		Endpoint:      result.Endpoint,
		DatabaseCount: result.DatabaseCount,
		TotalQueries:  result.TotalQueries,
		SlashedAmount: result.SlashedAmount,
	}, nil
}

// IsNodeHealthy checks if a node is healthy based on heartbeat.
func (c *EQLiteRegistryCaller) IsNodeHealthy(opts *bind.CallOpts, nodeId [32]byte) (bool, error) {
	var out []interface{}
	err := c.contract.Call(opts, &out, "isNodeHealthy", nodeId)
	if err != nil {
		return false, err
	}
	return out[0].(bool), nil
}

// GetActiveMiners returns all active miner node IDs.
func (c *EQLiteRegistryCaller) GetActiveMiners(opts *bind.CallOpts) ([][32]byte, error) {
	var out []interface{}
	err := c.contract.Call(opts, &out, "getActiveMiners")
	if err != nil {
		return nil, err
	}
	return out[0].([][32]byte), nil
}

// GetActiveBlockProducers returns all active block producer node IDs.
func (c *EQLiteRegistryCaller) GetActiveBlockProducers(opts *bind.CallOpts) ([][32]byte, error) {
	var out []interface{}
	err := c.contract.Call(opts, &out, "getActiveBlockProducers")
	if err != nil {
		return nil, err
	}
	return out[0].([][32]byte), nil
}

// GetDatabaseInfo retrieves database information from the registry.
func (c *EQLiteRegistryCaller) GetDatabaseInfo(opts *bind.CallOpts, databaseId [32]byte) (*DatabaseInfo, error) {
	var out []interface{}
	err := c.contract.Call(opts, &out, "getDatabaseInfo", databaseId)
	if err != nil {
		return nil, err
	}

	result := out[0].(struct {
		DatabaseId   [32]byte
		Owner        common.Address
		MinerNodeIds [][32]byte
		CreatedAt    *big.Int
		Active       bool
	})

	return &DatabaseInfo{
		DatabaseID:   result.DatabaseId,
		Owner:        result.Owner,
		MinerNodeIDs: result.MinerNodeIds,
		CreatedAt:    result.CreatedAt,
		Active:       result.Active,
	}, nil
}

// RegisterNode registers a new node with the registry.
func (t *EQLiteRegistryTransactor) RegisterNode(opts *bind.TransactOpts, nodeId [32]byte, role uint8, endpoint string, stakeAmount *big.Int) (*types.Transaction, error) {
	return t.contract.Transact(opts, "registerNode", nodeId, role, endpoint, stakeAmount)
}

// SubmitAttestation submits TEE attestation to activate a node.
func (t *EQLiteRegistryTransactor) SubmitAttestation(opts *bind.TransactOpts, nodeId [32]byte, attestation []byte, mrEnclave [32]byte) (*types.Transaction, error) {
	return t.contract.Transact(opts, "submitAttestation", nodeId, attestation, mrEnclave)
}

// Heartbeat sends a heartbeat to prove node is online.
func (t *EQLiteRegistryTransactor) Heartbeat(opts *bind.TransactOpts, nodeId [32]byte, queryCount *big.Int) (*types.Transaction, error) {
	return t.contract.Transact(opts, "heartbeat", nodeId, queryCount)
}

// CreateDatabase creates a new database in the registry.
func (t *EQLiteRegistryTransactor) CreateDatabase(opts *bind.TransactOpts, databaseId [32]byte, minerNodeIds [][32]byte) (*types.Transaction, error) {
	return t.contract.Transact(opts, "createDatabase", databaseId, minerNodeIds)
}
