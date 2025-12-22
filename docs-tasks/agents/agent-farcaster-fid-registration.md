# Agent Task: Farcaster FID Registration and Onboarding Flow

## Priority: P1
## Estimated Time: 2-3 days
## Dependencies: agent-farcaster-signer-kms

## Objective

Create a complete FID registration and onboarding flow that allows users to register new Farcaster accounts directly through Jeju, without requiring a separate Warpcast signup.

## Background

Farcaster IDs (FIDs) are registered on Optimism via:
1. ID Gateway contract (registers FID to custody address)
2. Storage Registry (rent storage units for messages)
3. Key Registry (add signers)

Current FID price: ~$5 (1 unit = $3 + gas)

## Source Files to Analyze

- `packages/farcaster/src/signer/` - Signer management
- Farcaster contracts: https://github.com/farcasterxyz/contracts

## Implementation Tasks

### 1. FID Registry Client

File: `packages/farcaster/src/registration/registry.ts`

```typescript
/**
 * Farcaster Registry Client
 * 
 * Interacts with Farcaster on-chain registries on Optimism.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  type Hex,
  encodeFunctionData,
  parseEther,
} from 'viem';
import { optimism } from 'viem/chains';

// Farcaster contract addresses on Optimism
export const FARCASTER_CONTRACTS = {
  ID_GATEWAY: '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69' as Address,
  ID_REGISTRY: '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b' as Address,
  STORAGE_REGISTRY: '0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d' as Address,
  KEY_REGISTRY: '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as Address,
  BUNDLER: '0x00000000FC04c910A0b5feA33b03E5320622718e' as Address,
} as const;

// ID Gateway ABI
const ID_GATEWAY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'recovery', type: 'address' },
    ],
    outputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'overpayment', type: 'uint256' },
    ],
  },
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Storage Registry ABI
const STORAGE_REGISTRY_ABI = [
  {
    name: 'rent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'units', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'unitPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Bundler ABI (registers FID, storage, and key in one tx)
const BUNDLER_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'registerParams',
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'recovery', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'sig', type: 'bytes' },
        ],
      },
      {
        name: 'signerParams',
        type: 'tuple[]',
        components: [
          { name: 'keyType', type: 'uint32' },
          { name: 'key', type: 'bytes' },
          { name: 'metadataType', type: 'uint8' },
          { name: 'metadata', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'sig', type: 'bytes' },
        ],
      },
      { name: 'extraStorage', type: 'uint256' },
    ],
    outputs: [{ name: 'fid', type: 'uint256' }],
  },
  {
    name: 'price',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'extraStorage', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export interface RegistryConfig {
  rpcUrl?: string;
}

export class FarcasterRegistryClient {
  private publicClient: PublicClient;
  
  constructor(config?: RegistryConfig) {
    this.publicClient = createPublicClient({
      chain: optimism,
      transport: http(config?.rpcUrl ?? 'https://mainnet.optimism.io'),
    });
  }
  
  /**
   * Get current FID registration price
   */
  async getRegistrationPrice(): Promise<bigint> {
    return this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.ID_GATEWAY,
      abi: ID_GATEWAY_ABI,
      functionName: 'price',
    });
  }
  
  /**
   * Get current storage unit price
   */
  async getStorageUnitPrice(): Promise<bigint> {
    return this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.STORAGE_REGISTRY,
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'unitPrice',
    });
  }
  
  /**
   * Get bundled registration price (FID + 1 storage unit + signer)
   */
  async getBundledPrice(extraStorage: number = 0): Promise<bigint> {
    return this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.BUNDLER,
      abi: BUNDLER_ABI,
      functionName: 'price',
      args: [BigInt(extraStorage)],
    });
  }
  
  /**
   * Build simple FID registration transaction
   */
  buildRegisterTx(params: {
    recovery: Address;
    value: bigint;
  }): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: ID_GATEWAY_ABI,
      functionName: 'register',
      args: [params.recovery],
    });
    
    return {
      to: FARCASTER_CONTRACTS.ID_GATEWAY,
      data,
      value: params.value,
    };
  }
  
  /**
   * Build bundled registration transaction (FID + storage + signer)
   */
  buildBundledRegisterTx(params: {
    to: Address;
    recovery: Address;
    signerPublicKey: Hex;
    deadline: number;
    registerSig: Hex;
    signerSig: Hex;
    extraStorage?: number;
    value: bigint;
  }): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: BUNDLER_ABI,
      functionName: 'register',
      args: [
        {
          to: params.to,
          recovery: params.recovery,
          deadline: BigInt(params.deadline),
          sig: params.registerSig,
        },
        [{
          keyType: 1, // Ed25519
          key: params.signerPublicKey,
          metadataType: 1, // Signed key request
          metadata: '0x' as Hex,
          deadline: BigInt(params.deadline),
          sig: params.signerSig,
        }],
        BigInt(params.extraStorage ?? 0),
      ],
    });
    
    return {
      to: FARCASTER_CONTRACTS.BUNDLER,
      data,
      value: params.value,
    };
  }
  
  /**
   * Build rent storage transaction
   */
  buildRentStorageTx(params: {
    fid: number;
    units: number;
    value: bigint;
  }): { to: Address; data: Hex; value: bigint } {
    const data = encodeFunctionData({
      abi: STORAGE_REGISTRY_ABI,
      functionName: 'rent',
      args: [BigInt(params.fid), BigInt(params.units)],
    });
    
    return {
      to: FARCASTER_CONTRACTS.STORAGE_REGISTRY,
      data,
      value: params.value,
    };
  }
  
  /**
   * Get FID for address from ID Registry
   */
  async getFidForAddress(address: Address): Promise<number | null> {
    // ID Registry idOf function
    const fid = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.ID_REGISTRY,
      abi: [{
        name: 'idOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      }],
      functionName: 'idOf',
      args: [address],
    });
    
    return fid > 0n ? Number(fid) : null;
  }
  
  /**
   * Get custody address for FID
   */
  async getCustodyAddress(fid: number): Promise<Address | null> {
    const address = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.ID_REGISTRY,
      abi: [{
        name: 'custodyOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'fid', type: 'uint256' }],
        outputs: [{ type: 'address' }],
      }],
      functionName: 'custodyOf',
      args: [BigInt(fid)],
    });
    
    return address === '0x0000000000000000000000000000000000000000' ? null : address;
  }
}
```

### 2. Onboarding Service

File: `packages/farcaster/src/registration/onboarding.ts`

```typescript
/**
 * Farcaster Onboarding Service
 * 
 * Complete onboarding flow: register FID, rent storage, add signer.
 */

import type { WalletClient, Address, Hex } from 'viem';
import { FarcasterRegistryClient } from './registry';
import { FarcasterSignerService } from '../signer/service';
import { FarcasterClient } from '../hub/client';

export interface OnboardingConfig {
  rpcUrl?: string;
  hubUrl?: string;
  kmsEndpoint?: string;
}

export interface OnboardingStatus {
  step: 'start' | 'pricing' | 'confirm' | 'registering' | 'configuring' | 'complete';
  fid?: number;
  signerKeyId?: string;
  txHash?: Hex;
  error?: string;
}

export interface OnboardingResult {
  fid: number;
  custodyAddress: Address;
  signerKeyId: string;
  signerPublicKey: Hex;
  storageUnits: number;
}

export class FarcasterOnboarding {
  private registry: FarcasterRegistryClient;
  private signerService: FarcasterSignerService;
  private hubClient: FarcasterClient;
  
  constructor(config?: OnboardingConfig) {
    this.registry = new FarcasterRegistryClient({ rpcUrl: config?.rpcUrl });
    this.signerService = new FarcasterSignerService({
      rpcUrl: config?.rpcUrl,
      kmsEndpoint: config?.kmsEndpoint,
    });
    this.hubClient = new FarcasterClient({ hubUrl: config?.hubUrl });
  }
  
  /**
   * Get registration pricing
   */
  async getPricing(): Promise<{
    fidPrice: bigint;
    storageUnitPrice: bigint;
    bundledPrice: bigint;
    recommended: bigint;
  }> {
    const [fidPrice, storageUnitPrice, bundledPrice] = await Promise.all([
      this.registry.getRegistrationPrice(),
      this.registry.getStorageUnitPrice(),
      this.registry.getBundledPrice(0),
    ]);
    
    return {
      fidPrice,
      storageUnitPrice,
      bundledPrice,
      recommended: bundledPrice, // 1 FID + 1 storage unit
    };
  }
  
  /**
   * Check if address already has FID
   */
  async hasExistingFid(address: Address): Promise<number | null> {
    return this.registry.getFidForAddress(address);
  }
  
  /**
   * Full onboarding flow
   */
  async register(params: {
    wallet: WalletClient;
    recovery?: Address;
    appName?: string;
    extraStorage?: number;
    onStatusUpdate?: (status: OnboardingStatus) => void;
  }): Promise<OnboardingResult> {
    const { wallet, onStatusUpdate } = params;
    const custodyAddress = wallet.account!.address;
    const recovery = params.recovery ?? custodyAddress;
    
    const updateStatus = (status: OnboardingStatus) => {
      onStatusUpdate?.(status);
    };
    
    try {
      // Step 1: Check if already registered
      updateStatus({ step: 'start' });
      const existingFid = await this.hasExistingFid(custodyAddress);
      if (existingFid) {
        throw new Error(`Address already has FID: ${existingFid}`);
      }
      
      // Step 2: Get pricing
      updateStatus({ step: 'pricing' });
      const pricing = await this.getPricing();
      
      // Step 3: Create signer
      updateStatus({ step: 'confirm' });
      const signerResult = await this.signerService.createSigner({
        fid: 0, // Will update after registration
        appName: params.appName ?? 'Jeju Network',
      });
      
      // Step 4: Prepare and send registration transaction
      updateStatus({ step: 'registering' });
      
      // Build simple registration (bundled requires app FID)
      const registerTx = this.registry.buildRegisterTx({
        recovery,
        value: pricing.fidPrice,
      });
      
      const txHash = await wallet.sendTransaction(registerTx);
      
      updateStatus({ step: 'registering', txHash });
      
      // Wait for transaction and get FID from event
      // In production, parse logs for registered FID
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const fid = await this.registry.getFidForAddress(custodyAddress);
      if (!fid) {
        throw new Error('Failed to get FID after registration');
      }
      
      // Step 5: Rent storage
      const storageTx = this.registry.buildRentStorageTx({
        fid,
        units: 1 + (params.extraStorage ?? 0),
        value: pricing.storageUnitPrice * BigInt(1 + (params.extraStorage ?? 0)),
      });
      
      await wallet.sendTransaction(storageTx);
      
      // Step 6: Add signer
      updateStatus({ step: 'configuring', fid });
      
      // Generate signed key request for on-chain registration
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      
      // User needs to approve signer via Warpcast or direct tx
      // For direct tx, build add key transaction
      const addKeyTx = {
        to: FARCASTER_CONTRACTS.KEY_REGISTRY,
        data: encodeFunctionData({
          abi: KEY_REGISTRY_ABI,
          functionName: 'add',
          args: [
            1, // keyType = Ed25519
            signerResult.signer.publicKey,
            0, // metadataType = none for self-add
            '0x' as Hex,
          ],
        }),
      };
      
      await wallet.sendTransaction(addKeyTx);
      
      // Mark signer as active
      await this.signerService.syncSignerStatus(signerResult.signer.keyId);
      
      updateStatus({ step: 'complete', fid, signerKeyId: signerResult.signer.keyId });
      
      return {
        fid,
        custodyAddress,
        signerKeyId: signerResult.signer.keyId,
        signerPublicKey: signerResult.signer.publicKey,
        storageUnits: 1 + (params.extraStorage ?? 0),
      };
    } catch (error) {
      updateStatus({
        step: 'start',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
  
  /**
   * Set up username after registration
   */
  async setUsername(params: {
    fid: number;
    username: string;
    signerKeyId: string;
  }): Promise<void> {
    // Username is set via UserData message to hub
    // This requires ENS or Farcaster fname registration
    
    const signer = await this.signerService.getSignerForPosting(params.fid);
    if (!signer) {
      throw new Error('No active signer');
    }
    
    // Build and send UserData message
    // This is a hub message, not on-chain
  }
  
  /**
   * Set profile data after registration
   */
  async setProfile(params: {
    fid: number;
    signerKeyId: string;
    displayName?: string;
    bio?: string;
    pfpUrl?: string;
  }): Promise<void> {
    // Set profile via UserData messages
  }
}
```

### 3. React Components

File: `packages/oauth3/src/react/components/FarcasterOnboarding.tsx`

```typescript
import { useState, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { FarcasterOnboarding, type OnboardingStatus } from '@jejunetwork/farcaster/registration';

export function FarcasterOnboardingFlow({
  onComplete,
  onError,
}: {
  onComplete: (result: OnboardingResult) => void;
  onError: (error: Error) => void;
}) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [status, setStatus] = useState<OnboardingStatus>({ step: 'start' });
  const [pricing, setPricing] = useState<{ fidPrice: bigint; bundledPrice: bigint } | null>(null);
  
  const startOnboarding = useCallback(async () => {
    if (!walletClient) return;
    
    const onboarding = new FarcasterOnboarding();
    
    try {
      // Get pricing first
      const prices = await onboarding.getPricing();
      setPricing(prices);
      
      // Start registration
      const result = await onboarding.register({
        wallet: walletClient,
        onStatusUpdate: setStatus,
      });
      
      onComplete(result);
    } catch (error) {
      onError(error as Error);
    }
  }, [walletClient, onComplete, onError]);
  
  return (
    <div className="farcaster-onboarding">
      {status.step === 'start' && (
        <div>
          <h2>Join Farcaster</h2>
          <p>Register your Farcaster account to start posting.</p>
          {pricing && (
            <p>Registration cost: {formatEther(pricing.bundledPrice)} ETH</p>
          )}
          <button onClick={startOnboarding}>
            Register Farcaster Account
          </button>
        </div>
      )}
      
      {status.step === 'registering' && (
        <div>
          <h2>Registering...</h2>
          <p>Please confirm the transaction in your wallet.</p>
          {status.txHash && (
            <a href={`https://optimistic.etherscan.io/tx/${status.txHash}`}>
              View transaction
            </a>
          )}
        </div>
      )}
      
      {status.step === 'configuring' && (
        <div>
          <h2>Setting up your account...</h2>
          <p>FID: {status.fid}</p>
        </div>
      )}
      
      {status.step === 'complete' && (
        <div>
          <h2>Welcome to Farcaster!</h2>
          <p>Your FID: {status.fid}</p>
        </div>
      )}
      
      {status.error && (
        <div className="error">
          <p>Error: {status.error}</p>
        </div>
      )}
    </div>
  );
}
```

## Acceptance Criteria

- [ ] Can get current FID registration price
- [ ] Can register new FID with custody wallet
- [ ] Can rent storage units
- [ ] Can add signer during registration
- [ ] Full onboarding flow works end-to-end
- [ ] React components for onboarding UI
- [ ] Error handling for all failure cases

## Output Files

1. `packages/farcaster/src/registration/registry.ts`
2. `packages/farcaster/src/registration/onboarding.ts`
3. `packages/farcaster/src/registration/index.ts`
4. `packages/oauth3/src/react/components/FarcasterOnboarding.tsx`

## Testing

```typescript
describe('FarcasterOnboarding', () => {
  test('gets registration pricing');
  test('checks existing FID');
  test('registers new FID');
  test('adds signer during registration');
  test('handles registration errors');
});
```

## Commands

```bash
cd packages/farcaster

# Run registration tests
bun test src/registration/*.test.ts

# Test against Optimism mainnet (requires funded wallet)
OPTIMISM_RPC_URL=... bun run test:registration
```

