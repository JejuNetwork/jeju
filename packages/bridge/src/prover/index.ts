/**
 * Prover Module
 *
 * ZK proof generation using SP1 and integration with TEE attestation.
 */

export {
  createSP1Client,
  type ProofRequest,
  type ProofResult,
  SP1Client,
  type SP1Config,
} from './sp1-client.js'
