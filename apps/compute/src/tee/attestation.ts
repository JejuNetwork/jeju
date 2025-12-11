/**
 * TEE Attestation
 *
 * ⚠️ SIMULATION MODE ⚠️
 *
 * This module SIMULATES TEE attestation for demonstration purposes.
 * Real attestation requires:
 * - Intel TDX hardware (for CPU attestation)
 * - NVIDIA H200 with Confidential Computing (for GPU attestation)
 * - Running inside a TEE environment
 *
 * The simulation demonstrates the DATA STRUCTURES and VERIFICATION LOGIC
 * but the signatures are NOT from real Intel/NVIDIA PKI.
 */

import { type Address, type Hex, keccak256, toBytes } from 'viem';

export interface AttestationQuote {
  // Measurement of the code running in the enclave
  mrEnclave: Hex;

  // Report data (can include operator address, git commit, etc.)
  reportData: Hex;

  // Signature from CPU attestation (simulated in demo mode)
  cpuSignature: Hex;

  // Signature from GPU attestation (simulated in demo mode)
  gpuSignature: Hex;

  // Timestamp when quote was generated
  timestamp: number;

  // TEE operator's Ethereum address (embedded in quote)
  operatorAddress: Address;

  // Flag indicating this is a simulation
  isSimulated: boolean;
}

export interface VerificationResult {
  valid: boolean;
  codeIntegrity: boolean;
  hardwareAuthentic: boolean;
  operatorAddress: Address;
  errors: string[];
  warnings: string[];
}

// Simulated signing keys - NOT real Intel/NVIDIA PKI!
// These are used to make the simulation internally consistent
const SIMULATED_INTEL_KEY = keccak256(toBytes('SIMULATION:INTEL:TDX'));
const SIMULATED_NVIDIA_KEY = keccak256(toBytes('SIMULATION:NVIDIA:CC'));

// Expected code measurement (hash of the game code)
let EXPECTED_MEASUREMENT: Hex | null = null;

/**
 * Set the expected code measurement for verification
 * In production: this would be the known-good hash of the game container
 */
export function setExpectedMeasurement(measurement: Hex): void {
  EXPECTED_MEASUREMENT = measurement;
  console.log(
    `[Attestation] Expected measurement set: ${measurement.slice(0, 16)}...`
  );
}

/**
 * Generate an attestation quote (SIMULATION)
 *
 * ⚠️ This is a SIMULATION - signatures are not from real hardware.
 * Use this for testing and demonstration only.
 */
export function generateQuote(
  codeHash: Hex,
  operatorAddress: Address,
  customReportData?: Hex
): AttestationQuote {
  const timestamp = Date.now();

  // Report data includes operator address and any custom data
  const reportData =
    customReportData ?? keccak256(toBytes(`${operatorAddress}:${timestamp}`));

  // Generate SIMULATED CPU signature
  const cpuQuoteMaterial = new Uint8Array([
    ...toBytes(codeHash),
    ...toBytes(reportData),
    ...toBytes(SIMULATED_INTEL_KEY),
  ]);
  const cpuSignature = keccak256(cpuQuoteMaterial);

  // Generate SIMULATED GPU signature
  const gpuQuoteMaterial = new Uint8Array([
    ...toBytes(codeHash),
    ...toBytes(reportData),
    ...toBytes(SIMULATED_NVIDIA_KEY),
  ]);
  const gpuSignature = keccak256(gpuQuoteMaterial);

  const quote: AttestationQuote = {
    mrEnclave: codeHash,
    reportData,
    cpuSignature,
    gpuSignature,
    timestamp,
    operatorAddress,
    isSimulated: true, // Honest flag!
  };

  console.log(`[Attestation] Generated quote for ${operatorAddress}`);
  return quote;
}

/**
 * Verify an attestation quote
 *
 * For SIMULATED quotes: Verifies internal consistency
 * For REAL quotes: Would verify against Intel/NVIDIA PKI (not implemented)
 */
export function verifyQuote(quote: AttestationQuote): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Warn about simulation mode
  if (quote.isSimulated) {
    warnings.push(
      'SIMULATION MODE: Attestation is not from real Intel/NVIDIA hardware'
    );
    warnings.push(
      'For production, deploy to a TEE provider'
    );
  }

  // Verify CPU signature (checks internal consistency)
  const expectedCpuSig = keccak256(
    new Uint8Array([
      ...toBytes(quote.mrEnclave),
      ...toBytes(quote.reportData),
      ...toBytes(SIMULATED_INTEL_KEY),
    ])
  );
  const cpuValid = expectedCpuSig === quote.cpuSignature;
  if (!cpuValid) {
    errors.push('Invalid CPU/TDX signature (internal consistency check)');
  }

  // Verify GPU signature (checks internal consistency)
  const expectedGpuSig = keccak256(
    new Uint8Array([
      ...toBytes(quote.mrEnclave),
      ...toBytes(quote.reportData),
      ...toBytes(SIMULATED_NVIDIA_KEY),
    ])
  );
  const gpuValid = expectedGpuSig === quote.gpuSignature;
  if (!gpuValid) {
    errors.push('Invalid GPU/CC signature (internal consistency check)');
  }

  // Check code integrity against expected measurement
  let codeIntegrity = true;
  if (EXPECTED_MEASUREMENT && quote.mrEnclave !== EXPECTED_MEASUREMENT) {
    codeIntegrity = false;
    errors.push(
      `Code measurement mismatch: expected ${EXPECTED_MEASUREMENT.slice(0, 16)}..., got ${quote.mrEnclave.slice(0, 16)}...`
    );
  }

  // Check quote freshness (must be within 1 hour)
  const maxAge = 60 * 60 * 1000; // 1 hour
  if (Date.now() - quote.timestamp > maxAge) {
    errors.push('Attestation quote is stale (> 1 hour old)');
  }

  return {
    valid: cpuValid && gpuValid && codeIntegrity && errors.length === 0,
    codeIntegrity,
    // Hardware authenticity is only true for non-simulated quotes
    hardwareAuthentic: !quote.isSimulated && cpuValid && gpuValid,
    operatorAddress: quote.operatorAddress,
    errors,
    warnings,
  };
}

/**
 * Format quote for display
 */
export function formatQuoteForDisplay(quote: AttestationQuote): string {
  const modeWarning = quote.isSimulated
    ? `
║  ⚠️ SIMULATION MODE - NOT REAL HARDWARE ATTESTATION ⚠️            ║
║                                                                   ║`
    : '';

  return `
╔═══════════════════════════════════════════════════════════════════╗
║                    TEE ATTESTATION REPORT                         ║
╠═══════════════════════════════════════════════════════════════════╣${modeWarning}
║ Code Measurement (mrEnclave):                                     ║
║   ${quote.mrEnclave}
║                                                                   ║
║ Operator Address:                                                 ║
║   ${quote.operatorAddress}
║                                                                   ║
║ Report Data:                                                      ║
║   ${quote.reportData}
║                                                                   ║
║ CPU (Intel TDX) Signature:                                        ║
║   ${quote.cpuSignature}
║                                                                   ║
║ GPU (NVIDIA CC) Signature:                                        ║
║   ${quote.gpuSignature}
║                                                                   ║
║ Timestamp: ${new Date(quote.timestamp).toISOString()}
╚═══════════════════════════════════════════════════════════════════╝`;
}
