/**
 * ZKSolBridge ABI Event Definitions
 * Auto-generated from contract ABI
 */

import { event } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

// Bridge Events
export const events = {
  TransferInitiated: event(
    '0xd5e9e85b2f8b4c4e4a7c3c1e8d3c3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f',
    'TransferInitiated(bytes32 indexed transferId, address indexed token, address indexed sender, bytes32 recipient, uint256 amount, uint256 destChainId)',
    {
      transferId: p.bytes32,
      token: p.address,
      sender: p.address,
      recipient: p.bytes32,
      amount: p.uint256,
      destChainId: p.uint256,
    },
  ),

  TransferCompleted: event(
    '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    'TransferCompleted(bytes32 indexed transferId, address indexed token, bytes32 sender, address indexed recipient, uint256 amount)',
    {
      transferId: p.bytes32,
      token: p.address,
      sender: p.bytes32,
      recipient: p.address,
      amount: p.uint256,
    },
  ),

  SlotVerified: event(
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    'SlotVerified(uint64 indexed slot, bytes32 bankHash)',
    {
      slot: p.uint64,
      bankHash: p.bytes32,
    },
  ),

  ProofSubmitted: event(
    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    'ProofSubmitted(bytes32 indexed transferId, bytes32 proofHash, uint256 timestamp)',
    {
      transferId: p.bytes32,
      proofHash: p.bytes32,
      timestamp: p.uint256,
    },
  ),

  LightClientUpdated: event(
    '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
    'LightClientUpdated(uint64 slot, bytes32 stateRoot, uint256 epoch)',
    {
      slot: p.uint64,
      stateRoot: p.bytes32,
      epoch: p.uint256,
    },
  ),
}

// Function selectors for reference
export const functions = {
  initiateTransfer: '0x12345678',
  completeTransfer: '0x87654321',
  updateLightClient: '0xabcdef12',
  verifyProof: '0x21fedcba',
}
