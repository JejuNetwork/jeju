/**
 * KMS Integration for Compute TEE
 * STATUS: REFERENCE - Not wired in. Uses @jeju/kms when available.
 */

import type { Address, Hex } from 'viem';

// Types - will be replaced by @jeju/kms imports
interface AccessControlPolicy { conditions: unknown[]; operator: 'and' | 'or' }
interface EncryptedPayload { ciphertext: string; dataToEncryptHash: string; accessControlConditions: unknown }
interface SignedMessage { signature: Hex; message: string; publicKey: Hex }

function notImplemented(): never { throw new Error('@jeju/kms not yet implemented'); }

export class ComputeKMS {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    notImplemented();
  }

  async encryptForProvider(_data: string, _providerAddress: Address, _registryAddress: Address): Promise<EncryptedPayload> {
    await this.ensureInitialized();
    notImplemented();
  }

  async encryptSSHKey(_sshPublicKey: string, _renterAddress: Address, _providerAddress: Address, _rentalId: string): Promise<EncryptedPayload> {
    await this.ensureInitialized();
    notImplemented();
  }

  async encryptModelWeights(_weights: Uint8Array, _modelId: string, _requiredAttestation: Hex): Promise<EncryptedPayload> {
    await this.ensureInitialized();
    notImplemented();
  }

  async signAttestation(_attestationData: { enclaveId: string; measurement: Hex; timestamp: number; providerAddress: Address }, _keyId: string): Promise<SignedMessage> {
    await this.ensureInitialized();
    notImplemented();
  }

  async decrypt(_payload: EncryptedPayload, _authSig?: { sig: Hex; derivedVia: string; signedMessage: string; address: Address }): Promise<string> {
    await this.ensureInitialized();
    notImplemented();
  }

  async generateKey(_owner: Address, _purpose: 'attestation' | 'encryption' | 'session'): Promise<{ keyId: string; publicKey: Hex }> {
    await this.ensureInitialized();
    notImplemented();
  }

  private async ensureInitialized(): Promise<void> { if (!this.initialized) await this.initialize(); }
  getStatus() { return { initialized: this.initialized }; }
}

let instance: ComputeKMS | null = null;
export function getComputeKMS(): ComputeKMS { return instance ?? (instance = new ComputeKMS()); }
export function resetComputeKMS(): void { instance = null; }
