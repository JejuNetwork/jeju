# Agent Task: Farcaster Signer Key Management with KMS

## Priority: P0
## Estimated Time: 2 days
## Dependencies: agent-farcaster-hub-posting, packages/kms

## Objective

Build a secure signer key management system for Farcaster that stores Ed25519 keys in TEE/KMS, enabling signing operations without exposing private keys to application code.

## Background

Farcaster uses Ed25519 signers for message authentication. Signers are:
- Delegated from the custody wallet (holds FID)
- Registered on-chain (Optimism)
- Used to sign all Farcaster messages

We need to:
- Generate signers in TEE
- Store signers securely in KMS
- Enable signing without key exposure
- Support multiple apps per FID

## Source Files to Analyze

- `packages/kms/src/kms.ts` - KMS service
- `packages/kms/src/providers/tee-provider.ts` - TEE provider
- `packages/farcaster/src/hub/poster.ts` - Uses signer for posting
- `@farcaster/hub-nodejs` - Signer registration

## Implementation Tasks

### 1. Signer Manager

File: `packages/farcaster/src/signer/manager.ts`

```typescript
/**
 * Farcaster Signer Manager
 * 
 * Manages Ed25519 signers for Farcaster, stored securely in KMS.
 */

import { KMSService, type GenerateKeyResult } from '@jejunetwork/kms';
import { ed25519 } from '@noble/curves/ed25519';
import type { Address, Hex } from 'viem';

export interface SignerInfo {
  keyId: string;
  publicKey: Hex;
  fid: number;
  appName: string;
  appFid?: number;
  status: 'pending' | 'active' | 'revoked';
  createdAt: number;
  approvedAt?: number;
}

export interface SignerManagerConfig {
  kmsEndpoint?: string;
  enclaveId?: string;
}

export class FarcasterSignerManager {
  private kms: KMSService;
  private signers: Map<string, SignerInfo> = new Map();
  
  constructor(config?: SignerManagerConfig) {
    this.kms = new KMSService({
      provider: config?.enclaveId ? 'tee' : 'local',
      endpoint: config?.kmsEndpoint,
      enclaveId: config?.enclaveId,
    });
  }
  
  /**
   * Generate a new signer key
   */
  async createSigner(params: {
    fid: number;
    appName: string;
    appFid?: number;
  }): Promise<SignerInfo> {
    const keyId = `fc-signer-${params.fid}-${Date.now()}`;
    
    // Generate Ed25519 key in KMS
    const result = await this.kms.generateKey({
      keyId,
      type: 'ed25519',
      policy: {
        owner: params.fid.toString(),
        operations: ['sign'],
      },
    });
    
    const signerInfo: SignerInfo = {
      keyId,
      publicKey: result.publicKey,
      fid: params.fid,
      appName: params.appName,
      appFid: params.appFid,
      status: 'pending',
      createdAt: Date.now(),
    };
    
    this.signers.set(keyId, signerInfo);
    
    return signerInfo;
  }
  
  /**
   * Get signer info by key ID
   */
  async getSigner(keyId: string): Promise<SignerInfo | null> {
    return this.signers.get(keyId) ?? null;
  }
  
  /**
   * Get all signers for an FID
   */
  async getSignersForFid(fid: number): Promise<SignerInfo[]> {
    return Array.from(this.signers.values())
      .filter(s => s.fid === fid);
  }
  
  /**
   * Get active signer for FID (first active one)
   */
  async getActiveSignerForFid(fid: number): Promise<SignerInfo | null> {
    const signers = await this.getSignersForFid(fid);
    return signers.find(s => s.status === 'active') ?? null;
  }
  
  /**
   * Sign a message with a signer
   */
  async sign(keyId: string, message: Uint8Array): Promise<Uint8Array> {
    const signer = this.signers.get(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    if (signer.status !== 'active') {
      throw new Error(`Signer not active: ${keyId}`);
    }
    
    const result = await this.kms.sign({
      keyId,
      message,
      hashAlgorithm: 'none', // Ed25519 handles hashing internally
    });
    
    return hexToBytes(result.signature.slice(2));
  }
  
  /**
   * Mark signer as approved (after on-chain registration)
   */
  async markApproved(keyId: string): Promise<void> {
    const signer = this.signers.get(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    signer.status = 'active';
    signer.approvedAt = Date.now();
  }
  
  /**
   * Revoke a signer
   */
  async revokeSigner(keyId: string): Promise<void> {
    const signer = this.signers.get(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    signer.status = 'revoked';
    
    // Delete from KMS
    await this.kms.deleteKey(keyId);
  }
  
  /**
   * Export signer public key in Farcaster format
   */
  async getSignerPublicKeyBytes(keyId: string): Promise<Uint8Array> {
    const signer = this.signers.get(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    return hexToBytes(signer.publicKey.slice(2));
  }
}
```

### 2. Signer Registration

File: `packages/farcaster/src/signer/registration.ts`

```typescript
/**
 * Farcaster Signer Registration
 * 
 * Handles on-chain signer registration on Optimism.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hex,
  encodeFunctionData,
} from 'viem';
import { optimism } from 'viem/chains';
import { FarcasterSignerManager, type SignerInfo } from './manager';

// Farcaster Key Registry on Optimism
const KEY_REGISTRY_ADDRESS = '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as const;

// Key Registry ABI (simplified)
const KEY_REGISTRY_ABI = [
  {
    name: 'add',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyType', type: 'uint32' },
      { name: 'key', type: 'bytes' },
      { name: 'metadataType', type: 'uint8' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'remove',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'keyDataOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'key', type: 'bytes' },
    ],
    outputs: [
      { name: 'state', type: 'uint8' },
      { name: 'keyType', type: 'uint32' },
    ],
  },
] as const;

export interface SignerRegistrationConfig {
  rpcUrl?: string;
}

export class SignerRegistration {
  private publicClient: PublicClient;
  
  constructor(config?: SignerRegistrationConfig) {
    this.publicClient = createPublicClient({
      chain: optimism,
      transport: http(config?.rpcUrl ?? 'https://mainnet.optimism.io'),
    });
  }
  
  /**
   * Generate the add signer transaction data
   */
  buildAddSignerTx(params: {
    publicKey: Hex;
    appFid?: number;
    deadline?: number;
  }): { to: Address; data: Hex } {
    const publicKeyBytes = hexToBytes(params.publicKey.slice(2));
    
    // Encode metadata (app info)
    const metadata = params.appFid
      ? encodeMetadata({ requestFid: params.appFid, deadline: params.deadline ?? 0 })
      : new Uint8Array(0);
    
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'add',
      args: [
        1, // keyType = 1 (Ed25519 signer)
        bytesToHex(publicKeyBytes) as Hex,
        1, // metadataType = 1 (signed key request)
        bytesToHex(metadata) as Hex,
      ],
    });
    
    return { to: KEY_REGISTRY_ADDRESS, data };
  }
  
  /**
   * Generate Warpcast deep link for signer approval
   */
  generateWarpcastApprovalLink(params: {
    publicKey: Hex;
    deadline: number;
    signature: Hex;
  }): string {
    const base = 'https://warpcast.com/~/signer-request';
    const searchParams = new URLSearchParams({
      publicKey: params.publicKey,
      deadline: params.deadline.toString(),
      signature: params.signature,
    });
    
    return `${base}?${searchParams.toString()}`;
  }
  
  /**
   * Check if signer is registered for FID
   */
  async isSignerRegistered(fid: number, publicKey: Hex): Promise<boolean> {
    const [state] = await this.publicClient.readContract({
      address: KEY_REGISTRY_ADDRESS,
      abi: KEY_REGISTRY_ABI,
      functionName: 'keyDataOf',
      args: [BigInt(fid), publicKey],
    });
    
    // state: 0 = null, 1 = added, 2 = removed
    return state === 1;
  }
  
  /**
   * Build remove signer transaction
   */
  buildRemoveSignerTx(publicKey: Hex): { to: Address; data: Hex } {
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'remove',
      args: [publicKey],
    });
    
    return { to: KEY_REGISTRY_ADDRESS, data };
  }
}

function encodeMetadata(params: { requestFid: number; deadline: number }): Uint8Array {
  // Simplified encoding - in production use proper ABI encoding
  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(params));
}
```

### 3. Signer Service (Combines Manager + Registration)

File: `packages/farcaster/src/signer/service.ts`

```typescript
/**
 * Farcaster Signer Service
 * 
 * High-level service for managing Farcaster signers.
 */

import { FarcasterSignerManager, type SignerInfo } from './manager';
import { SignerRegistration } from './registration';
import type { WalletClient, Address, Hex } from 'viem';

export interface SignerServiceConfig {
  kmsEndpoint?: string;
  enclaveId?: string;
  rpcUrl?: string;
}

export interface CreateSignerResult {
  signer: SignerInfo;
  approvalLink: string;
  transaction?: { to: Address; data: Hex };
}

export class FarcasterSignerService {
  private manager: FarcasterSignerManager;
  private registration: SignerRegistration;
  
  constructor(config?: SignerServiceConfig) {
    this.manager = new FarcasterSignerManager({
      kmsEndpoint: config?.kmsEndpoint,
      enclaveId: config?.enclaveId,
    });
    this.registration = new SignerRegistration({
      rpcUrl: config?.rpcUrl,
    });
  }
  
  /**
   * Create a new signer and get approval link
   */
  async createSigner(params: {
    fid: number;
    appName: string;
    appFid?: number;
    wallet?: WalletClient;
  }): Promise<CreateSignerResult> {
    // Create signer in KMS
    const signer = await this.manager.createSigner({
      fid: params.fid,
      appName: params.appName,
      appFid: params.appFid,
    });
    
    // Generate approval deadline (24 hours from now)
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    
    // If we have wallet, generate signed request
    let approvalLink: string;
    let transaction: { to: Address; data: Hex } | undefined;
    
    if (params.wallet && params.appFid) {
      // Sign the key request metadata
      const message = this.buildSignerRequestMessage({
        publicKey: signer.publicKey,
        requestFid: params.appFid,
        deadline,
      });
      
      const signature = await params.wallet.signMessage({
        message: { raw: message },
      });
      
      approvalLink = this.registration.generateWarpcastApprovalLink({
        publicKey: signer.publicKey,
        deadline,
        signature,
      });
      
      transaction = this.registration.buildAddSignerTx({
        publicKey: signer.publicKey,
        appFid: params.appFid,
        deadline,
      });
    } else {
      // Direct registration link (user signs in Warpcast)
      approvalLink = `https://warpcast.com/~/add-key?publicKey=${signer.publicKey}`;
    }
    
    return { signer, approvalLink, transaction };
  }
  
  /**
   * Get signer for posting
   */
  async getSignerForPosting(fid: number): Promise<{
    sign: (message: Uint8Array) => Promise<Uint8Array>;
    publicKey: Uint8Array;
  } | null> {
    const signer = await this.manager.getActiveSignerForFid(fid);
    if (!signer) return null;
    
    return {
      sign: (message) => this.manager.sign(signer.keyId, message),
      publicKey: hexToBytes(signer.publicKey.slice(2)),
    };
  }
  
  /**
   * Check and update signer status from chain
   */
  async syncSignerStatus(keyId: string): Promise<SignerInfo> {
    const signer = await this.manager.getSigner(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    const isRegistered = await this.registration.isSignerRegistered(
      signer.fid,
      signer.publicKey,
    );
    
    if (isRegistered && signer.status === 'pending') {
      await this.manager.markApproved(keyId);
      signer.status = 'active';
    }
    
    return signer;
  }
  
  /**
   * Revoke a signer
   */
  async revokeSigner(keyId: string, wallet: WalletClient): Promise<Hex> {
    const signer = await this.manager.getSigner(keyId);
    if (!signer) {
      throw new Error(`Signer not found: ${keyId}`);
    }
    
    // Build and send revoke transaction
    const tx = this.registration.buildRemoveSignerTx(signer.publicKey);
    
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
    });
    
    // Mark as revoked in manager
    await this.manager.revokeSigner(keyId);
    
    return hash;
  }
  
  /**
   * List all signers for FID
   */
  async listSigners(fid: number): Promise<SignerInfo[]> {
    return this.manager.getSignersForFid(fid);
  }
  
  private buildSignerRequestMessage(params: {
    publicKey: Hex;
    requestFid: number;
    deadline: number;
  }): Uint8Array {
    const message = `Farcaster Signer Request\n\nPublic Key: ${params.publicKey}\nRequest FID: ${params.requestFid}\nDeadline: ${params.deadline}`;
    return new TextEncoder().encode(message);
  }
}
```

### 4. Integration with Poster

File: `packages/farcaster/src/hub/poster.ts` (update)

```typescript
// Update FarcasterPoster to use SignerService

import { FarcasterSignerService } from '../signer/service';

export interface FarcasterPosterConfig {
  fid: number;
  hubUrl: string;
  network?: 'mainnet' | 'testnet';
  // New: Use signer service instead of raw private key
  signerService?: FarcasterSignerService;
  // Deprecated: Direct private key (for backward compatibility)
  signerPrivateKey?: Uint8Array;
}

export class FarcasterPoster {
  // ... existing code ...
  
  private signerService?: FarcasterSignerService;
  
  constructor(config: FarcasterPosterConfig) {
    // ... existing setup ...
    
    this.signerService = config.signerService;
    
    if (!config.signerService && !config.signerPrivateKey) {
      throw new Error('Either signerService or signerPrivateKey required');
    }
  }
  
  /**
   * Get signer for message signing
   */
  private async getSigner(): Promise<{
    sign: (msg: Uint8Array) => Promise<Uint8Array>;
    publicKey: Uint8Array;
  }> {
    if (this.signerService) {
      const signer = await this.signerService.getSignerForPosting(this.fid);
      if (!signer) {
        throw new Error('No active signer found for FID');
      }
      return signer;
    }
    
    // Fallback to direct private key
    return {
      sign: async (msg) => ed25519.sign(msg, this.signerPrivateKey!),
      publicKey: ed25519.getPublicKey(this.signerPrivateKey!),
    };
  }
}
```

## Acceptance Criteria

- [ ] Can create signer keys in KMS
- [ ] Keys are stored securely (TEE when available)
- [ ] Can generate Warpcast approval links
- [ ] Can check on-chain registration status
- [ ] Signing works without exposing private key
- [ ] Multiple signers per FID supported
- [ ] Revocation works

## Output Files

1. `packages/farcaster/src/signer/manager.ts`
2. `packages/farcaster/src/signer/registration.ts`
3. `packages/farcaster/src/signer/service.ts`
4. `packages/farcaster/src/signer/index.ts`
5. `packages/farcaster/src/hub/poster.ts` (update)

## Testing

```typescript
describe('SignerService', () => {
  test('creates signer in KMS');
  test('generates approval link');
  test('syncs status from chain');
  test('signs message without exposing key');
  test('revokes signer');
});
```

## Commands

```bash
cd packages/farcaster

# Run signer tests
bun test src/signer/*.test.ts

# Type check
bun run typecheck
```

