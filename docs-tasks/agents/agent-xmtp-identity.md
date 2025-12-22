# Agent Task: XMTP Identity Integration with OAuth3 and Jeju Registry

## Priority: P0
## Estimated Time: 2 days
## Dependencies: agent-xmtp-mls-sdk

## Objective

Connect XMTP identity creation to Jeju's OAuth3 authentication system and on-chain identity registry, ensuring a unified identity experience across public (Farcaster) and private (XMTP) messaging.

## Background

Currently users have:
- Ethereum wallet address (base identity)
- Farcaster FID (optional, for public messaging)
- OAuth3 session (for app authentication)

We need to add:
- XMTP identity (for private messaging)
- Unified identity registry entry

All identities should be discoverable from any starting point.

## Source Files to Analyze

- `packages/oauth3/src/types.ts` - Identity types
- `packages/oauth3/src/providers/farcaster.ts` - Farcaster identity
- `packages/oauth3/src/credentials/verifiable-credentials.ts` - VCs
- `packages/shared/src/auth/types.ts` - Auth types
- `packages/contracts/src/oauth3/OAuth3IdentityRegistry.sol` - Registry

## Implementation Tasks

### 1. XMTP Identity Provider

File: `packages/oauth3/src/providers/xmtp.ts`

```typescript
/**
 * XMTP Identity Provider
 * 
 * Creates and manages XMTP identities linked to Jeju accounts.
 */

import { Client as XMTPClient } from '@xmtp/xmtp-js';
import type { WalletClient, Address, Hex } from 'viem';
import type { LinkedProvider, AuthProvider } from '../types.js';

export interface XMTPIdentity {
  /** XMTP installation ID (unique per device) */
  installationId: string;
  /** XMTP public key bundle */
  publicKeyBundle: {
    identityKey: Hex;
    preKey: Hex;
  };
  /** Linked Ethereum address */
  address: Address;
  /** Linked Farcaster FID (if any) */
  fid?: number;
  /** Creation timestamp */
  createdAt: number;
}

export class XMTPProvider {
  private client: XMTPClient | null = null;
  
  constructor(
    private readonly env: 'production' | 'dev' = 'production',
  ) {}
  
  /**
   * Create XMTP identity from wallet
   */
  async createIdentity(wallet: WalletClient): Promise<XMTPIdentity> {
    this.client = await XMTPClient.create(wallet, {
      env: this.env,
    });
    
    return {
      installationId: this.client.installationId,
      publicKeyBundle: {
        identityKey: toHex(this.client.publicKeyBundle.identityKey),
        preKey: toHex(this.client.publicKeyBundle.preKey),
      },
      address: wallet.account.address,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Check if address has XMTP identity
   */
  async canMessage(address: Address): Promise<boolean> {
    return XMTPClient.canMessage(address, { env: this.env });
  }
  
  /**
   * Get XMTP identity for address
   */
  async getIdentity(address: Address): Promise<XMTPIdentity | null> {
    const canMessage = await this.canMessage(address);
    if (!canMessage) return null;
    
    // Fetch public key bundle from XMTP network
    // ...
  }
  
  /**
   * Convert to LinkedProvider for OAuth3
   */
  toLinkedProvider(identity: XMTPIdentity): LinkedProvider {
    return {
      provider: 'xmtp' as AuthProvider,
      providerId: identity.installationId,
      providerHandle: identity.address,
      linkedAt: identity.createdAt,
      verified: true,
      credential: null,
    };
  }
}

export const xmtpProvider = new XMTPProvider();
```

### 2. Update OAuth3 Types

File: `packages/oauth3/src/types.ts` (update)

```typescript
// Add to AuthProvider type
export type AuthProvider = 
  | 'ethereum'
  | 'farcaster'
  | 'xmtp'  // Add this
  | 'twitter'
  | 'google'
  | 'github';

// Add XMTP identity type
export interface XMTPIdentity {
  installationId: string;
  publicKeyBundle: {
    identityKey: Hex;
    preKey: Hex;
  };
  address: Address;
  fid?: number;
  createdAt: number;
}

// Update FullIdentity type
export interface FullIdentity {
  address: Address;
  farcaster?: FarcasterIdentity;
  xmtp?: XMTPIdentity;  // Add this
  linkedProviders: LinkedProvider[];
  createdAt: number;
  updatedAt: number;
}
```

### 3. Unified Identity Registry Integration

File: `packages/oauth3/src/registry/unified.ts`

```typescript
/**
 * Unified Identity Registry
 * 
 * Links all identity types (wallet, Farcaster, XMTP) in one on-chain registry.
 */

import type { Address, Hex } from 'viem';
import { FarcasterProvider } from '../providers/farcaster.js';
import { XMTPProvider } from '../providers/xmtp.js';

export interface UnifiedIdentity {
  address: Address;
  fid?: number;
  xmtpInstallationId?: string;
  linkedProviders: LinkedProvider[];
  registeredAt: number;
}

export class UnifiedIdentityRegistry {
  constructor(
    private readonly registryAddress: Address,
    private readonly wallet: WalletClient,
  ) {}
  
  /**
   * Register or update unified identity
   */
  async register(params: {
    xmtpIdentity?: XMTPIdentity;
    farcasterFid?: number;
  }): Promise<Hex> {
    // Encode identity data
    // Call OAuth3IdentityRegistry.registerIdentity()
  }
  
  /**
   * Lookup identity by any identifier
   */
  async lookup(identifier: Address | number | string): Promise<UnifiedIdentity | null> {
    // If Address: direct lookup
    // If number: lookup by FID
    // If string: lookup by XMTP installation ID
  }
  
  /**
   * Check if user can receive private messages
   */
  async canReceiveMessages(address: Address): Promise<{
    xmtp: boolean;
    jeju: boolean;
  }> {
    const [xmtpEnabled, jejuKey] = await Promise.all([
      this.xmtpProvider.canMessage(address),
      this.keyRegistry.getKey(address),
    ]);
    
    return {
      xmtp: xmtpEnabled,
      jeju: jejuKey !== null && jejuKey.isActive,
    };
  }
}
```

### 4. Update OAuth3 Session to Include XMTP

File: `packages/oauth3/src/session/manager.ts` (update)

```typescript
// Add XMTP to session creation
export async function createSession(params: CreateSessionParams): Promise<Session> {
  const session: Session = {
    // ... existing fields ...
    
    // Add XMTP identity if messaging enabled
    xmtpIdentity: params.enableMessaging 
      ? await xmtpProvider.createIdentity(params.wallet)
      : undefined,
  };
  
  // Register in unified registry
  await unifiedRegistry.register({
    xmtpIdentity: session.xmtpIdentity,
    farcasterFid: session.farcasterIdentity?.fid,
  });
  
  return session;
}
```

### 5. Identity Discovery Service

File: `packages/oauth3/src/discovery/index.ts`

```typescript
/**
 * Identity Discovery Service
 * 
 * Find users across all identity providers.
 */

export interface DiscoveredUser {
  address: Address;
  displayName?: string;
  avatarUrl?: string;
  farcaster?: { fid: number; username: string };
  xmtp?: { canMessage: boolean };
  jeju?: { hasKey: boolean };
}

export class IdentityDiscovery {
  /**
   * Search for users by name, address, or handle
   */
  async search(query: string): Promise<DiscoveredUser[]> {
    // Search Farcaster for username matches
    // Search on-chain registry for address matches
    // Combine and deduplicate results
  }
  
  /**
   * Get messaging capabilities for address
   */
  async getMessagingCapabilities(address: Address): Promise<{
    farcasterDM: boolean;
    xmtp: boolean;
    jejuPrivate: boolean;
  }> {
    // Check all messaging capabilities
  }
  
  /**
   * Resolve ENS/Farcaster name to address
   */
  async resolveIdentifier(identifier: string): Promise<Address | null> {
    // Check if it's an ENS name
    // Check if it's a Farcaster username
    // Return resolved address
  }
}
```

### 6. React Hook for Identity

File: `packages/oauth3/src/react/hooks/useXMTPIdentity.ts`

```typescript
import { useState, useEffect } from 'react';
import { useOAuth3 } from './useOAuth3';
import { xmtpProvider } from '../../providers/xmtp';

export function useXMTPIdentity() {
  const { session, wallet } = useOAuth3();
  const [identity, setIdentity] = useState<XMTPIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const createIdentity = async () => {
    if (!wallet) throw new Error('No wallet connected');
    setLoading(true);
    try {
      const newIdentity = await xmtpProvider.createIdentity(wallet);
      setIdentity(newIdentity);
      return newIdentity;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  const canMessage = async (address: Address) => {
    return xmtpProvider.canMessage(address);
  };
  
  return {
    identity: identity ?? session?.xmtpIdentity,
    createIdentity,
    canMessage,
    loading,
    error,
  };
}
```

## Acceptance Criteria

- [ ] XMTP identity can be created from wallet signature
- [ ] XMTP identity is stored in OAuth3 session
- [ ] Unified registry links wallet/Farcaster/XMTP identities
- [ ] Identity discovery works across all providers
- [ ] React hooks available for frontend integration
- [ ] Existing OAuth3 flows updated to include XMTP

## Output Files

1. `packages/oauth3/src/providers/xmtp.ts`
2. `packages/oauth3/src/registry/unified.ts`
3. `packages/oauth3/src/discovery/index.ts`
4. `packages/oauth3/src/react/hooks/useXMTPIdentity.ts`
5. `packages/oauth3/src/types.ts` (update)
6. `packages/oauth3/src/session/manager.ts` (update)

## Testing

```typescript
describe('XMTP Identity', () => {
  test('creates XMTP identity from wallet');
  test('links XMTP to existing Farcaster identity');
  test('discovers user by Farcaster username');
  test('discovers user by XMTP installation ID');
  test('checks messaging capabilities');
});
```

## Commands

```bash
cd packages/oauth3

# Install dependencies
bun add @xmtp/xmtp-js

# Run tests
bun test src/providers/xmtp.test.ts

# Type check
bun run typecheck
```

