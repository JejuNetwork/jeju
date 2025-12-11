/**
 * Attestation generation for compute nodes
 */

import type { Wallet } from 'ethers';
import { verifyMessage } from 'ethers';
import { detectHardware, generateHardwareHash } from './hardware';
import type { AttestationReport } from './types';

export async function generateAttestation(
  wallet: Wallet,
  nonce: string
): Promise<AttestationReport> {
  const hardware = await detectHardware();
  const timestamp = new Date().toISOString();
  const teeStatus = hardware.teeInfo.status;
  const teeIsReal = hardware.teeInfo.isReal;

  // Create message to sign
  const message = JSON.stringify({
    signingAddress: wallet.address,
    hardware: generateHardwareHash(hardware),
    timestamp,
    nonce,
    teeStatus,
  });

  // Sign with provider's wallet
  const signature = await wallet.signMessage(message);

  // Generate warning for non-production TEE
  const teeWarning = teeIsReal 
    ? null 
    : `⚠️ TEE STATUS: ${teeStatus.toUpperCase()} - ${hardware.teeInfo.warning || 'Not suitable for production use'}`;

  return {
    signingAddress: wallet.address,
    hardware,
    timestamp,
    nonce,
    signature,
    // Legacy field for backwards compatibility
    simulated: !teeIsReal,
    // New TEE status fields
    teeStatus,
    teeIsReal,
    teeWarning,
  };
}

export async function generateSimulatedAttestation(
  wallet: Wallet,
  nonce: string
): Promise<AttestationReport> {
  return generateAttestation(wallet, nonce);
}

export async function verifyAttestation(
  attestation: AttestationReport,
  expectedAddress: string,
  requireRealTEE: boolean = false
): Promise<{ valid: boolean; reason?: string; warnings: string[] }> {
  const warnings: string[] = [];

  // Check signing address matches
  if (
    attestation.signingAddress.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    return { valid: false, reason: 'Signing address mismatch', warnings };
  }

  if (requireRealTEE && !attestation.teeIsReal) {
    return { 
      valid: false, 
      reason: `Real TEE required but got: ${attestation.teeStatus}`,
      warnings,
    };
  }

  if (!attestation.teeIsReal && attestation.teeWarning) {
    warnings.push(attestation.teeWarning);
  }
  const teeStatus = attestation.teeStatus || (attestation.simulated ? 'simulated' : 'intel-tdx');

  if (teeStatus === 'simulated') {
    const message = JSON.stringify({
      signingAddress: attestation.signingAddress,
      hardware: generateHardwareHash(attestation.hardware),
      timestamp: attestation.timestamp,
      nonce: attestation.nonce,
      teeStatus,
    });

    const recovered = verifyMessage(message, attestation.signature);

    if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
      return { valid: false, reason: 'Signature verification failed', warnings };
    }

    return { valid: true, warnings };
  }

  if (teeStatus === 'intel-tdx') {
    const dcapResult = await verifyDCAPAttestation(attestation);
    if (!dcapResult.valid) {
      return { valid: false, reason: dcapResult.reason, warnings };
    }
    warnings.push(...dcapResult.warnings);
    return { valid: true, warnings };
  }

  if (teeStatus === 'amd-sev' || teeStatus === 'aws-nitro') {
    const message = JSON.stringify({
      signingAddress: attestation.signingAddress,
      hardware: generateHardwareHash(attestation.hardware),
      timestamp: attestation.timestamp,
      nonce: attestation.nonce,
      teeStatus,
    });

    const recovered = verifyMessage(message, attestation.signature);
    if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
      return { valid: false, reason: 'Signature verification failed', warnings };
    }

    warnings.push(`${teeStatus} attestation - full DCAP verification not implemented`);
    return { valid: true, warnings };
  }

  return {
    valid: false,
    reason: `Unknown TEE status: ${teeStatus}`,
    warnings,
  };
}

const DCAP_ENDPOINT = process.env.DCAP_ENDPOINT || process.env.TEE_DCAP_ENDPOINT || 'https://dcap.phala.network/verify';

interface DCAPVerificationResult {
  valid: boolean;
  reason?: string;
  warnings: string[];
  measurement?: string;
  mrEnclave?: string;
  mrSigner?: string;
}

async function verifyDCAPAttestation(
  attestation: AttestationReport
): Promise<DCAPVerificationResult> {
  const warnings: string[] = [];

  // If no quote provided, fall back to signature verification
  if (!attestation.signature || !attestation.signature.startsWith('0x')) {
    return {
      valid: false,
      reason: 'Missing attestation quote',
      warnings,
    };
  }

  // In development/testing, skip DCAP if endpoint not available
  if (process.env.SKIP_DCAP_VERIFICATION === 'true') {
    warnings.push('DCAP verification skipped (SKIP_DCAP_VERIFICATION=true)');
    return { valid: true, warnings };
  }

  try {
    const response = await fetch(DCAP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quote: attestation.signature,
        reportData: attestation.nonce,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 503) {
        warnings.push('DCAP service temporarily unavailable - verification deferred');
        return { valid: true, warnings };
      }
      return {
        valid: false,
        reason: `DCAP verification failed: ${response.status} ${response.statusText}`,
        warnings,
      };
    }

    const result = await response.json() as {
      verified: boolean;
      error?: string;
      measurement?: string;
      mrEnclave?: string;
      mrSigner?: string;
      tcbStatus?: string;
    };

    if (!result.verified) {
      return {
        valid: false,
        reason: result.error || 'DCAP verification failed',
        warnings,
      };
    }

    if (result.tcbStatus && result.tcbStatus !== 'UpToDate') {
      warnings.push(`TCB Status: ${result.tcbStatus} - Consider updating TEE firmware`);
    }

    return {
      valid: true,
      warnings,
      measurement: result.measurement,
      mrEnclave: result.mrEnclave,
      mrSigner: result.mrSigner,
    };

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      warnings.push(`DCAP verification skipped: ${(error as Error).message}`);
      return { valid: true, warnings };
    }
    
    return {
      valid: false,
      reason: `DCAP verification error: ${(error as Error).message}`,
      warnings,
    };
  }
}

export function isAttestationFresh(
  attestation: AttestationReport,
  maxAgeMs: number = 3600000 // 1 hour default
): boolean {
  const attestationTime = new Date(attestation.timestamp).getTime();
  const now = Date.now();
  return now - attestationTime < maxAgeMs;
}

export function getAttestationHash(attestation: AttestationReport): string {
  const data = JSON.stringify({
    signingAddress: attestation.signingAddress,
    hardwareHash: generateHardwareHash(attestation.hardware),
    timestamp: attestation.timestamp,
  });

  const hash = Bun.hash(data);
  return `0x${hash.toString(16).padStart(64, '0')}`;
}
