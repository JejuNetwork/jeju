/**
 * Cryptographic Primitives for DA Layer
 * 
 * Production-ready implementations:
 * - BLS12-381 signatures with proper pairing verification
 * - KZG polynomial commitments with trusted setup
 * - 2D Reed-Solomon erasure coding
 * - Hash-to-curve per RFC 9380
 */

// BLS Signatures
export {
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
  hashToG2 as blsHashToG2,
  hashToG1 as blsHashToG1,
  createAttestationMessage,
  signAttestation,
  verifyAttestation,
  createAggregatedAttestation,
  verifyAggregatedAttestation,
  createProofOfPossession,
  verifyProofOfPossession,
  type BLSPublicKey,
  type BLSSecretKey,
  type BLSSignature,
  type BLSKeyPair,
  type AggregatedSignature,
} from './bls';

// KZG Commitments
export {
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
  verifyProof as verifyKZGProof,
  verifyBlobProof,
  verifyBlobProofBatch,
  verifyCommitmentForData,
  computeVersionedHash,
  FIELD_ELEMENTS_PER_BLOB,
  BYTES_PER_FIELD_ELEMENT,
  BLOB_SIZE,
  COMMITMENT_SIZE,
  PROOF_SIZE,
  BLS_MODULUS,
  type KZGCommitment,
  type KZGProof,
  type Blob,
  type BlobWithCommitment,
  type CommitmentWithProof,
} from './kzg';

// 2D Reed-Solomon
export {
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
} from './reed-solomon-2d';

// Hash-to-Curve
export {
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
  G1Generator,
  G2Generator,
  compressG1,
  decompressG1,
  compressG2,
  decompressG2,
  DST_BLS_SIG,
  DST_BLS_POP,
  DST_DA_ATTEST,
  DST_DA_SAMPLE,
  type G1Point,
  type G2Point,
  type DST,
} from './hash-to-curve';

