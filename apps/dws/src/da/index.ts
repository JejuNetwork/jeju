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

// Core types
export * from './types';

// Erasure coding
export { ReedSolomonCodec, createReedSolomonCodec } from './erasure';

// Polynomial commitments
export { 
  createCommitment, 
  verifyProof,
  computeBlobId,
  type PolynomialCommitment,
} from './commitment';

// Data availability sampling
export { 
  DASampler, 
  SampleVerifier, 
  generateSampleIndices,
  calculateRequiredSamples,
  type SamplingConfig,
} from './sampling';

// Blob management
export { 
  BlobManager, 
  BlobSubmission, 
  type BlobStatus,
} from './blob';

// DA operator node
export { 
  DAOperator, 
  createDAOperator,
  type OperatorConfig, 
  type OperatorStatus,
} from './operator';

// Disperser service
export { 
  Disperser, 
  createDisperser,
  type DispersalResult, 
  type DispersalConfig,
} from './disperser';

// Integration with DWS
export { DAGateway, createDAGateway, createDARouter } from './gateway';

// Client SDK
export { 
  DAClient, 
  createDAClient,
  createDefaultDAClient,
  type DAClientConfig,
} from './client';

// Production Cryptographic Primitives
export {
  // BLS Signatures with proper pairing verification
  BLS,
  generateKeyPair,
  derivePublicKey,
  validateSecretKey,
  validatePublicKey,
  sign,
  signWithDomain,
  verify,
  verifyWithDomain,
  aggregateSignatures,
  aggregatePublicKeys,
  verifyAggregate,
  verifyBatch,
  signAttestation,
  verifyAttestation,
  createAggregatedAttestation,
  verifyAggregatedAttestation,
  createProofOfPossession,
  verifyProofOfPossession,
  type BLSPublicKey,
  type BLSSignature,
  type BLSSecretKey,
  type BLSKeyPair,
  type AggregatedSignature,

  // KZG Polynomial Commitments
  KZG,
  initializeKZG,
  isKZGInitialized,
  createBlob,
  validateBlob,
  computeCommitment,
  commitToBlob,
  computeCommitments,
  computeProof,
  computeBlobProof,
  computeCellProofs,
  verifyKZGProof,
  verifyBlobProof,
  verifyBlobProofBatch,
  verifyCommitmentForData,
  computeVersionedHash,
  BLOB_SIZE,
  COMMITMENT_SIZE,
  PROOF_SIZE,
  BLS_MODULUS,
  type KZGCommitment,
  type KZGProof,
  type Blob,
  type BlobWithCommitment,
  type CommitmentWithProof,

  // 2D Reed-Solomon for PeerDAS
  ReedSolomon2D,
  gfMul,
  gfDiv,
  gfPow,
  gfInv,
  gfAdd,
  createMatrix,
  flattenMatrix,
  extend2D,
  reconstruct2D,
  canReconstruct,
  verifyExtended,
  extractColumn,
  extractRow,
  type Matrix2D,
  type ExtendedMatrix2D,
  type CellCoord,

  // Hash-to-Curve (RFC 9380)
  HashToCurve,
  hashToG1,
  hashToG2,
  encodeToG1,
  encodeToG2,
  hashToField,
  expandMessageXMD,
  verifyG1Point,
  verifyG2Point,
  addG1Points,
  addG2Points,
  mulG1,
  mulG2,
  DST_BLS_SIG,
  DST_BLS_POP,
  DST_DA_ATTEST,
  DST_DA_SAMPLE,
  type G1Point,
  type G2Point,
  type DST,
} from './crypto';

// Rollup Integrations
export {
  RollupDAAdapter,
  createRollupDAAdapter,
  OPStackDAAdapter,
  createOPStackDAAdapter,
  ArbitrumOrbitDAAdapter,
  createArbitrumOrbitDAAdapter,
  type RollupConfig,
  type BatchData,
  type DAReference,
  type OPStackConfig,
  type ArbitrumOrbitConfig,
} from './integrations';

// PeerDAS Integration (EIP-7594 compatible)
export {
  PeerDAS,
  PeerDASBlobManager,
  createPeerDASBlobManager,
  // Constants
  DATA_COLUMN_COUNT,
  EXTENDED_COLUMN_COUNT,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_BLOB_SIZE,
  CUSTODY_COLUMNS_PER_NODE,
  SAMPLES_PER_SLOT,
  // Types
  type ColumnIndex,
  type SubnetId,
  type PeerDASBlob,
  type DataColumn,
  type CustodyAssignment,
  type PeerDASSampleRequest,
  type PeerDASSampleResponse,
} from './peerdas';

