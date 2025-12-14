/**
 * MPC Module Exports
 *
 * Multi-Party Computation for threshold signing and key management.
 * Integrates with TEE infrastructure for hardware-protected operations.
 */

export { MPCNodeService, type MPCNodeConfig, type MPCNodeStatus } from './node-service.js';
export { ThresholdKeyManager, type KeyShare, type ThresholdConfig } from './threshold-key-manager.js';
export { SigningCoordinator, type SigningSession, type PartialSignature } from './signing-coordinator.js';
export { MPCServer, type MPCServerConfig, startMPCNode } from './mpc-server.js';
export {
  type MPCRequest,
  type MPCResponse,
  type KeyGenRequest,
  type KeyGenResponse,
  type SignRequest,
  type SignResponse,
  MPCMessageType,
} from './types.js';
