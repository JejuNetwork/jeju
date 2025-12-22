# Agent Task: TEE-Backed Key Management for XMTP

## Priority: P0
## Estimated Time: 2 days
## Dependencies: agent-xmtp-mls-sdk, packages/kms

## Objective

Integrate XMTP key management with Jeju's TEE (Trusted Execution Environment) infrastructure, ensuring that private keys never leave the secure enclave while maintaining full XMTP/MLS functionality.

## Background

Currently XMTP stores keys in browser localStorage or file system, which is insecure. We need:
- Key generation inside TEE
- Key usage (signing, ECDH) inside TEE
- Key export only as encrypted backup
- Remote attestation for key operations

## Source Files to Analyze

- `packages/kms/src/providers/tee-provider.ts` - TEE provider
- `packages/kms/src/kms.ts` - KMS service
- `packages/kms/src/crypto/sealing.ts` - Key sealing
- `packages/messaging/src/sdk/crypto.ts` - Current crypto

## Implementation Tasks

### 1. TEE XMTP Key Manager

File: `packages/messaging/src/tee/key-manager.ts`

```typescript
/**
 * TEE-Backed XMTP Key Manager
 * 
 * Manages XMTP identity keys within a TEE enclave.
 * Keys are generated and used inside the TEE, never exposed to application code.
 */

import { KMSService, TEEProvider, type TEEAttestation } from '@jejunetwork/kms';
import type { Address, Hex } from 'viem';

export interface TEEKeyConfig {
  kmsEndpoint: string;
  enclaveId: string;
  attestationRequired: boolean;
}

export interface TEEIdentityKey {
  keyId: string;
  publicKey: Hex;
  attestation?: TEEAttestation;
  createdAt: number;
}

export class TEEXMTPKeyManager {
  private kms: KMSService;
  
  constructor(config: TEEKeyConfig) {
    this.kms = new KMSService({
      provider: 'tee',
      endpoint: config.kmsEndpoint,
      enclaveId: config.enclaveId,
    });
  }
  
  /**
   * Generate XMTP identity key inside TEE
   */
  async generateIdentityKey(address: Address): Promise<TEEIdentityKey> {
    const keyId = `xmtp-identity-${address}-${Date.now()}`;
    
    // Generate Ed25519 key inside TEE
    const result = await this.kms.generateKey({
      keyId,
      type: 'ed25519',
      policy: {
        owner: address,
        operations: ['sign', 'derive'],
        attestation: true,
      },
    });
    
    return {
      keyId,
      publicKey: result.publicKey,
      attestation: result.attestation,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Generate XMTP pre-key inside TEE
   */
  async generatePreKey(identityKeyId: string): Promise<{
    keyId: string;
    publicKey: Hex;
    signature: Hex;
  }> {
    const preKeyId = `${identityKeyId}-prekey-${Date.now()}`;
    
    // Generate X25519 pre-key
    const preKey = await this.kms.generateKey({
      keyId: preKeyId,
      type: 'x25519',
      policy: { parentKey: identityKeyId },
    });
    
    // Sign pre-key with identity key
    const signature = await this.kms.sign({
      keyId: identityKeyId,
      message: preKey.publicKey,
    });
    
    return {
      keyId: preKeyId,
      publicKey: preKey.publicKey,
      signature: signature.signature,
    };
  }
  
  /**
   * Sign message with XMTP identity key
   */
  async sign(keyId: string, message: Uint8Array): Promise<Hex> {
    const result = await this.kms.sign({
      keyId,
      message,
      hashAlgorithm: 'sha256',
    });
    return result.signature;
  }
  
  /**
   * Perform ECDH key exchange inside TEE
   */
  async sharedSecret(
    privateKeyId: string,
    theirPublicKey: Hex,
  ): Promise<Uint8Array> {
    return this.kms.ecdh({
      keyId: privateKeyId,
      publicKey: theirPublicKey,
    });
  }
  
  /**
   * Export encrypted backup of keys
   */
  async exportEncrypted(
    keyId: string,
    backupPassword: string,
  ): Promise<string> {
    return this.kms.exportKey({
      keyId,
      format: 'encrypted',
      password: backupPassword,
    });
  }
  
  /**
   * Import key from encrypted backup
   */
  async importFromBackup(
    encryptedBackup: string,
    password: string,
    newKeyId: string,
  ): Promise<TEEIdentityKey> {
    const result = await this.kms.importKey({
      keyId: newKeyId,
      encryptedKey: encryptedBackup,
      password,
    });
    
    return {
      keyId: newKeyId,
      publicKey: result.publicKey,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Get TEE attestation for key
   */
  async getAttestation(keyId: string): Promise<TEEAttestation> {
    return this.kms.getAttestation(keyId);
  }
  
  /**
   * Verify TEE attestation
   */
  async verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
    return this.kms.verifyAttestation(attestation);
  }
}
```

### 2. XMTP Signer Implementation for TEE

File: `packages/messaging/src/tee/xmtp-signer.ts`

```typescript
/**
 * XMTP Signer that uses TEE for all crypto operations
 */

import type { Signer, SignedPublicKeyBundle } from '@xmtp/xmtp-js';
import { TEEXMTPKeyManager, type TEEIdentityKey } from './key-manager';

export class TEEXMTPSigner implements Signer {
  constructor(
    private readonly keyManager: TEEXMTPKeyManager,
    private readonly identityKey: TEEIdentityKey,
  ) {}
  
  async getAddress(): Promise<string> {
    // Derive address from public key
    return deriveAddressFromPublicKey(this.identityKey.publicKey);
  }
  
  async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
    const messageBytes = typeof message === 'string' 
      ? new TextEncoder().encode(message)
      : message;
    
    const signature = await this.keyManager.sign(
      this.identityKey.keyId,
      messageBytes,
    );
    
    return hexToBytes(signature);
  }
  
  /**
   * Create signed public key bundle for XMTP registration
   */
  async createSignedPublicKeyBundle(): Promise<SignedPublicKeyBundle> {
    const preKey = await this.keyManager.generatePreKey(this.identityKey.keyId);
    
    return {
      identityKey: {
        secp256k1Uncompressed: hexToBytes(this.identityKey.publicKey),
        signature: await this.signMessage(this.identityKey.publicKey),
      },
      preKey: {
        secp256k1Uncompressed: hexToBytes(preKey.publicKey),
        signature: hexToBytes(preKey.signature),
      },
    };
  }
}

/**
 * Create XMTP client with TEE signer
 */
export async function createTEEXMTPClient(
  keyManager: TEEXMTPKeyManager,
  address: Address,
): Promise<XMTPClient> {
  // Get or create identity key
  let identityKey = await keyManager.getIdentityKey(address);
  if (!identityKey) {
    identityKey = await keyManager.generateIdentityKey(address);
  }
  
  const signer = new TEEXMTPSigner(keyManager, identityKey);
  
  return XMTPClient.create(signer, {
    env: 'production',
  });
}
```

### 3. Key Registry Sync

File: `packages/messaging/src/tee/registry-sync.ts`

```typescript
/**
 * Syncs TEE-managed keys with on-chain KeyRegistry
 */

import type { Address, Hex } from 'viem';
import { TEEXMTPKeyManager } from './key-manager';

export class KeyRegistrySync {
  constructor(
    private readonly keyManager: TEEXMTPKeyManager,
    private readonly registryAddress: Address,
    private readonly wallet: WalletClient,
  ) {}
  
  /**
   * Register TEE key in on-chain registry
   */
  async registerOnChain(keyId: string): Promise<Hex> {
    const key = await this.keyManager.getKey(keyId);
    const attestation = await this.keyManager.getAttestation(keyId);
    
    // Encode attestation proof
    const attestationProof = encodeAttestation(attestation);
    
    // Call KeyRegistry.registerKeyBundle with TEE attestation
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'registerKeyBundleWithAttestation',
      args: [
        key.publicKey,
        key.preKey?.publicKey ?? key.publicKey,
        key.preKey?.signature ?? '0x',
        attestationProof,
      ],
    });
    
    return this.wallet.sendTransaction({
      to: this.registryAddress,
      data,
    });
  }
  
  /**
   * Verify on-chain key matches TEE key
   */
  async verifyRegistration(address: Address): Promise<boolean> {
    const [onChainKey, teeKey] = await Promise.all([
      this.getOnChainKey(address),
      this.keyManager.getIdentityKey(address),
    ]);
    
    if (!onChainKey || !teeKey) return false;
    
    return onChainKey.identityKey === teeKey.publicKey;
  }
}
```

### 4. Update KMS Provider for XMTP

File: `packages/kms/src/providers/tee-provider.ts` (update)

Add XMTP-specific methods:

```typescript
export class TEEProvider implements KMSProvider {
  // ... existing code ...
  
  /**
   * XMTP-specific: Derive installation key from identity
   */
  async deriveInstallationKey(
    identityKeyId: string,
    deviceId: string,
  ): Promise<{ keyId: string; publicKey: Hex }> {
    const derivedKeyId = `${identityKeyId}-installation-${deviceId}`;
    
    // HKDF derivation inside TEE
    const result = await this.deriveKey({
      parentKeyId: identityKeyId,
      keyId: derivedKeyId,
      info: `xmtp-installation-${deviceId}`,
    });
    
    return { keyId: derivedKeyId, publicKey: result.publicKey };
  }
  
  /**
   * XMTP-specific: MLS welcome message decryption
   */
  async decryptMLSWelcome(
    keyId: string,
    welcomeMessage: Uint8Array,
  ): Promise<Uint8Array> {
    // Decrypt MLS welcome inside TEE
    return this.decrypt({
      keyId,
      ciphertext: welcomeMessage,
      algorithm: 'mls-welcome',
    });
  }
}
```

## Acceptance Criteria

- [ ] XMTP identity keys are generated inside TEE
- [ ] All signing operations happen inside TEE
- [ ] ECDH key exchange happens inside TEE
- [ ] Keys can be backed up encrypted
- [ ] Keys are registered on-chain with TEE attestation
- [ ] XMTP client works with TEE signer
- [ ] Attestation is verifiable

## Output Files

1. `packages/messaging/src/tee/key-manager.ts`
2. `packages/messaging/src/tee/xmtp-signer.ts`
3. `packages/messaging/src/tee/registry-sync.ts`
4. `packages/messaging/src/tee/index.ts`
5. `packages/kms/src/providers/tee-provider.ts` (update)

## Testing

```typescript
describe('TEE XMTP Keys', () => {
  test('generates identity key in TEE');
  test('signs message without exposing private key');
  test('performs ECDH in TEE');
  test('exports encrypted backup');
  test('imports from encrypted backup');
  test('registers key with TEE attestation');
  test('XMTP client works with TEE signer');
});
```

## Commands

```bash
cd packages/messaging

# Run TEE tests (requires TEE environment or mock)
TEE_MOCK=true bun test src/tee/*.test.ts

# Type check
bun run typecheck
```

