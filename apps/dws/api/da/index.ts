/**
 * Jeju Data Availability Layer
 *
 * High-performance, TEE-secured data availability service.
 *
 * For cryptographic primitives, import directly from:
 * - ./crypto/bls for BLS signatures
 * - ./crypto/kzg for KZG commitments
 * - ./crypto/hash-to-curve for hash-to-curve
 * - ./crypto/reed-solomon-2d for 2D erasure coding
 *
 * For PeerDAS, import directly from ./peerdas
 * For rollup integrations, import directly from ./integrations
 */

// Blob management
export { BlobManager, type BlobStatus, BlobSubmission } from './blob'

// Polynomial commitments
export {
  computeBlobId,
  createCommitment,
  type PolynomialCommitment,
  verifyProof,
} from './commitment'

// Disperser service
export {
  createDisperser,
  type DispersalConfig,
  type DispersalResult,
  Disperser,
} from './disperser'

// Erasure coding
export { createReedSolomonCodec, ReedSolomonCodec } from './erasure'

// Integration with DWS
export { createDAGateway, createDARouter, DAGateway } from './gateway'

// DA operator node
export {
  createDAOperator,
  DAOperator,
  type OperatorConfig,
  type OperatorStatus,
} from './operator'

// Data availability sampling
export {
  calculateRequiredSamples,
  DASampler,
  generateSampleIndices,
  SampleVerifier,
  type SamplingConfig,
} from './sampling'

// Core types
export * from './types'
