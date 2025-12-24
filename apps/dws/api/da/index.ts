/**
 * Jeju Data Availability Layer
 *
 * High-performance, TEE-secured data availability service:
 * - Erasure coding (Reed-Solomon) for data redundancy
 * - Polynomial commitments for efficient verification
 * - Data availability sampling for lightweight verification
 * - Native integration with DWS infrastructure
 * - Restaking-based operator incentives
 *
 * Architecture:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     Rollup / L2 Client                         │
 * │  - Submit blob data with commitment                            │
 * │  - Verify data availability via sampling                       │
 * │  - Retrieve data when needed                                   │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   DA Gateway / Disperser                       │
 * │  - Erasure encode blobs into chunks                            │
 * │  - Generate polynomial commitments                             │
 * │  - Disperse chunks to DA operators                             │
 * │  - Return commitment + availability proof                      │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   On-Chain Registry                            │
 * │  - DA operator staking and registration                        │
 * │  - Blob commitment storage                                     │
 * │  - Slashing for unavailability                                 │
 * │  - Payment and reward distribution                             │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   DA Operator Nodes                            │
 * │  - Store assigned data chunks                                  │
 * │  - Respond to sampling queries                                 │
 * │  - TEE attestation for data integrity                          │
 * │  - P2P chunk distribution                                      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Key Features:
 *
 * 1. ERASURE CODING
 *    - Reed-Solomon encoding for 2x redundancy
 *    - Data reconstructable from 50% of chunks
 *    - Configurable coding ratio
 *
 * 2. POLYNOMIAL COMMITMENTS
 *    - Efficient verification without full data
 *    - Opening proofs for individual chunks
 *    - Batch verification support
 *
 * 3. DATA AVAILABILITY SAMPLING
 *    - Lightweight verification via random sampling
 *    - Statistical guarantee of availability
 *    - Network-level sampling coordination
 *
 * 4. TEE SECURITY
 *    - Operators run in TEE enclaves
 *    - Proof-of-Cloud attestation
 *    - Hardware-backed integrity guarantees
 *
 * 5. ECONOMIC SECURITY
 *    - Operators stake tokens to participate
 *    - Slashing for unavailability
 *    - Rewards for reliable service
 */

// Blob management
export {
  BlobManager,
  type BlobStatus,
  BlobSubmission,
} from './blob'
// Client SDK
export {
  createDAClient,
  createDefaultDAClient,
  DAClient,
  type DAClientConfig,
} from './client'

// Polynomial commitments
export {
  computeBlobId,
  createCommitment,
  type PolynomialCommitment,
  verifyProof,
} from './commitment'
// Production Cryptographic Primitives
export {
  type AggregatedSignature,
  addG1Points,
  addG2Points,
  aggregatePublicKeys,
  aggregateSignatures,
  BLOB_SIZE,
  // BLS Signatures with proper pairing verification
  BLS,
  BLS_MODULUS,
  type BLSKeyPair,
  type BLSPublicKey,
  type BLSSecretKey,
  type BLSSignature,
  type Blob,
  type BlobWithCommitment,
  type CellCoord,
  COMMITMENT_SIZE,
  type CommitmentWithProof,
  canReconstruct,
  commitToBlob,
  compressG1,
  compressG2,
  computeBlobProof,
  computeCellProofs,
  computeCommitment,
  computeCommitments,
  computeProof,
  computeVersionedHash,
  createAggregatedAttestation,
  createBlob,
  createMatrix,
  createProofOfPossession,
  type DST,
  DST_BLS_POP,
  DST_BLS_SIG,
  DST_DA_ATTEST,
  DST_DA_SAMPLE,
  decompressG1,
  decompressG2,
  derivePublicKey,
  type ExtendedMatrix2D,
  encodeToG1,
  encodeToG2,
  expandMessageXMD,
  extend2D,
  extractColumn,
  extractRow,
  flattenMatrix,
  G1Generator,
  type G1Point,
  G2Generator,
  type G2Point,
  generateKeyPair,
  gfAdd,
  gfDiv,
  gfInv,
  gfMul,
  gfPow,
  // Hash-to-Curve (RFC 9380)
  HashToCurve,
  hashToField,
  hashToG1,
  hashToG2,
  initializeKZG,
  isKZGInitialized,
  // KZG Polynomial Commitments
  KZG,
  type KZGCommitment,
  type KZGProof,
  type Matrix2D,
  mulG1,
  mulG2,
  PROOF_SIZE,
  // 2D Reed-Solomon for PeerDAS
  ReedSolomon2D,
  reconstruct2D,
  sign,
  signAttestation,
  signWithDomain,
  validateBlob,
  validatePublicKey,
  validateSecretKey,
  verify,
  verifyAggregate,
  verifyAggregatedAttestation,
  verifyAttestation,
  verifyBatch,
  verifyBlobProof,
  verifyBlobProofBatch,
  verifyCommitmentForData,
  verifyExtended,
  verifyG1Point,
  verifyG2Point,
  verifyKZGProof,
  verifyProofOfPossession,
  verifyWithDomain,
} from './crypto'
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
// Rollup Integrations
export {
  type ArbitrumOrbitConfig,
  ArbitrumOrbitDAAdapter,
  type BatchData,
  createArbitrumOrbitDAAdapter,
  createOPStackDAAdapter,
  createRollupDAAdapter,
  type DAReference,
  type OPStackConfig,
  OPStackDAAdapter,
  type RollupConfig,
  RollupDAAdapter,
} from './integrations'
// DA operator node
export {
  createDAOperator,
  DAOperator,
  type OperatorConfig,
  type OperatorStatus,
} from './operator'
// PeerDAS Integration (EIP-7594 compatible)
export {
  // Types
  type ColumnIndex,
  CUSTODY_COLUMNS_PER_NODE,
  type CustodyAssignment,
  createPeerDASBlobManager,
  // Constants
  DATA_COLUMN_COUNT,
  type DataColumn,
  EXTENDED_COLUMN_COUNT,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_BLOB_SIZE,
  PeerDAS,
  type PeerDASBlob,
  PeerDASBlobManager,
  type PeerDASSampleRequest,
  type PeerDASSampleResponse,
  SAMPLES_PER_SLOT,
  type SubnetId,
} from './peerdas'
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
