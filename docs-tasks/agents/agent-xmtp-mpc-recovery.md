# Agent Task: MPC Threshold Recovery for XMTP Identities

## Priority: P0
## Estimated Time: 2 days
## Dependencies: agent-xmtp-tee-keys, packages/kms

## Objective

Implement MPC (Multi-Party Computation) threshold recovery for XMTP identity keys, allowing users to recover their messaging identity even if they lose access to their primary device while maintaining security guarantees.

## Background

Users can lose access to their messaging keys by:
- Losing their device
- Forgetting backup password
- Browser data cleared

MPC recovery allows k-of-n threshold recovery where:
- User holds 1 share
- Jeju TEE nodes hold n-1 shares
- k shares needed to recover (typically k=2)

## Source Files to Analyze

- `packages/kms/src/providers/mpc-provider.ts` - MPC provider
- `packages/oauth3/src/infrastructure/threshold-encryption.ts` - Threshold crypto
- `packages/messaging/src/tee/key-manager.ts` - TEE key manager

## Implementation Tasks

### 1. MPC Recovery Service

File: `packages/messaging/src/mpc/recovery-service.ts`

```typescript
/**
 * MPC Recovery Service
 * 
 * Manages threshold key recovery for XMTP identities.
 * Uses Shamir Secret Sharing with MPC computation for reconstruction.
 */

import { MPCProvider, type MPCShare } from '@jejunetwork/kms';
import type { Address, Hex } from 'viem';

export interface RecoveryConfig {
  /** Number of shares needed to recover (k) */
  threshold: number;
  /** Total number of shares (n) */
  totalShares: number;
  /** MPC node endpoints */
  mpcNodes: string[];
  /** Recovery challenge questions */
  securityQuestions: boolean;
}

export interface RecoverySetup {
  /** Recovery ID for lookup */
  recoveryId: string;
  /** User's encrypted share */
  userShare: EncryptedShare;
  /** Hash of recovery answers (if using security questions) */
  answersHash?: Hex;
  /** Timestamp */
  createdAt: number;
}

export interface EncryptedShare {
  /** Encrypted share data */
  ciphertext: string;
  /** Salt for key derivation */
  salt: string;
  /** IV for encryption */
  iv: string;
}

export class MPCRecoveryService {
  private mpc: MPCProvider;
  
  constructor(config: RecoveryConfig) {
    this.mpc = new MPCProvider({
      threshold: config.threshold,
      totalParties: config.totalShares,
      endpoints: config.mpcNodes,
    });
  }
  
  /**
   * Setup recovery for an XMTP identity key
   */
  async setupRecovery(params: {
    keyId: string;
    address: Address;
    backupPassword: string;
    securityAnswers?: string[];
  }): Promise<RecoverySetup> {
    // Generate Shamir shares of the private key
    const shares = await this.mpc.generateShares(params.keyId);
    
    // Encrypt user's share with backup password
    const userShare = await this.encryptUserShare(
      shares.userShare,
      params.backupPassword,
    );
    
    // Distribute other shares to MPC nodes (encrypted with their public keys)
    await this.distributeShares(params.keyId, shares.nodeShares);
    
    // If using security questions, hash the answers
    const answersHash = params.securityAnswers
      ? keccak256(concat(params.securityAnswers.map(a => toBytes(a.toLowerCase()))))
      : undefined;
    
    // Store recovery metadata on-chain
    const recoveryId = await this.registerRecovery({
      address: params.address,
      keyId: params.keyId,
      answersHash,
    });
    
    return {
      recoveryId,
      userShare,
      answersHash,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Initiate recovery process
   */
  async initiateRecovery(params: {
    address: Address;
    backupPassword?: string;
    securityAnswers?: string[];
    newDevicePublicKey: Hex;
  }): Promise<RecoverySession> {
    // Lookup recovery setup
    const setup = await this.getRecoverySetup(params.address);
    if (!setup) {
      throw new Error('No recovery setup found for this address');
    }
    
    // Verify identity (either password or security questions)
    let userShare: Uint8Array | null = null;
    
    if (params.backupPassword && setup.userShare) {
      userShare = await this.decryptUserShare(
        setup.userShare,
        params.backupPassword,
      );
    }
    
    if (params.securityAnswers && setup.answersHash) {
      const providedHash = keccak256(
        concat(params.securityAnswers.map(a => toBytes(a.toLowerCase())))
      );
      if (providedHash !== setup.answersHash) {
        throw new Error('Security answers do not match');
      }
    }
    
    // Request MPC recovery session
    const session = await this.mpc.initiateRecovery({
      recoveryId: setup.recoveryId,
      userShare,
      newDevicePublicKey: params.newDevicePublicKey,
    });
    
    return session;
  }
  
  /**
   * Complete recovery after MPC computation
   */
  async completeRecovery(
    sessionId: string,
    devicePrivateKey: Uint8Array,
  ): Promise<{ keyId: string; publicKey: Hex }> {
    // Get MPC result (encrypted to new device's public key)
    const result = await this.mpc.getRecoveryResult(sessionId);
    
    // Decrypt the recovered key
    const recoveredKey = await this.decryptRecoveryResult(
      result.encryptedKey,
      devicePrivateKey,
    );
    
    // Import into TEE
    const imported = await this.importToTEE(recoveredKey, result.keyId);
    
    return imported;
  }
  
  /**
   * Distribute shares to MPC nodes
   */
  private async distributeShares(
    keyId: string,
    shares: MPCShare[],
  ): Promise<void> {
    await Promise.all(
      shares.map(async (share, i) => {
        const node = this.mpc.nodes[i];
        
        // Encrypt share with node's TEE public key
        const encryptedShare = await encryptToTEE(share, node.publicKey);
        
        // Send to node
        await fetch(`${node.endpoint}/shares`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyId,
            share: encryptedShare,
          }),
        });
      })
    );
  }
  
  /**
   * Encrypt user's share with password
   */
  private async encryptUserShare(
    share: Uint8Array,
    password: string,
  ): Promise<EncryptedShare> {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Derive key from password
    const key = await deriveKeyFromPassword(password, salt);
    
    // Encrypt share
    const ciphertext = await encryptAESGCM(share, key, iv);
    
    return {
      ciphertext: bytesToHex(ciphertext),
      salt: bytesToHex(salt),
      iv: bytesToHex(iv),
    };
  }
}
```

### 2. Recovery UI Components

File: `packages/oauth3/src/react/components/RecoveryFlow.tsx`

```typescript
/**
 * Recovery Flow Component
 */

import { useState } from 'react';
import { useMPCRecovery } from '../hooks/useMPCRecovery';

export function RecoveryFlow({ address, onComplete }: RecoveryFlowProps) {
  const [step, setStep] = useState<'method' | 'verify' | 'complete'>('method');
  const [method, setMethod] = useState<'password' | 'questions' | null>(null);
  const { initiateRecovery, completeRecovery, loading, error } = useMPCRecovery();
  
  const handlePasswordRecovery = async (password: string) => {
    const session = await initiateRecovery({
      address,
      backupPassword: password,
    });
    setStep('complete');
    await completeRecovery(session.id);
    onComplete();
  };
  
  const handleQuestionsRecovery = async (answers: string[]) => {
    const session = await initiateRecovery({
      address,
      securityAnswers: answers,
    });
    setStep('complete');
    await completeRecovery(session.id);
    onComplete();
  };
  
  return (
    <div>
      {step === 'method' && (
        <RecoveryMethodSelector onSelect={setMethod} />
      )}
      {step === 'verify' && method === 'password' && (
        <PasswordRecoveryForm onSubmit={handlePasswordRecovery} />
      )}
      {step === 'verify' && method === 'questions' && (
        <SecurityQuestionsForm onSubmit={handleQuestionsRecovery} />
      )}
      {step === 'complete' && (
        <RecoveryProgress loading={loading} error={error} />
      )}
    </div>
  );
}
```

### 3. MPC Node Handler

File: `packages/messaging/src/mpc/node-handler.ts`

```typescript
/**
 * MPC Node Request Handler
 * 
 * Handles recovery share storage and MPC computation requests.
 */

import { Hono } from 'hono';

export function createMPCNodeHandler(config: MPCNodeConfig): Hono {
  const app = new Hono();
  
  // Store recovery share
  app.post('/shares', async (c) => {
    const { keyId, share } = await c.req.json();
    
    // Verify TEE attestation of requesting client
    const attestation = c.req.header('X-TEE-Attestation');
    if (!await verifyAttestation(attestation)) {
      return c.json({ error: 'Invalid attestation' }, 401);
    }
    
    // Decrypt and store share in TEE
    await storeShareInTEE(keyId, share);
    
    return c.json({ success: true });
  });
  
  // Participate in recovery MPC
  app.post('/recovery/participate', async (c) => {
    const { sessionId, recoveryId } = await c.req.json();
    
    // Get our share
    const share = await getShareFromTEE(recoveryId);
    
    // Participate in MPC computation
    const result = await participateInMPC(sessionId, share);
    
    return c.json(result);
  });
  
  return app;
}
```

### 4. Social Recovery Option

File: `packages/messaging/src/mpc/social-recovery.ts`

```typescript
/**
 * Social Recovery
 * 
 * Allows recovery via trusted contacts (guardians).
 */

export interface Guardian {
  address: Address;
  name: string;
  addedAt: number;
}

export class SocialRecovery {
  constructor(
    private readonly mpcService: MPCRecoveryService,
    private readonly minGuardians: number = 3,
    private readonly requiredApprovals: number = 2,
  ) {}
  
  /**
   * Add guardian for social recovery
   */
  async addGuardian(params: {
    owner: Address;
    guardian: Address;
    name: string;
  }): Promise<void> {
    // Verify guardian has messaging capability
    const canMessage = await this.canMessageGuardian(params.guardian);
    if (!canMessage) {
      throw new Error('Guardian must have messaging enabled');
    }
    
    // Add guardian to recovery config
    await this.storeGuardian(params);
    
    // Notify guardian
    await this.notifyGuardian(params.guardian, params.owner);
  }
  
  /**
   * Initiate social recovery
   */
  async initiateRecovery(params: {
    address: Address;
    newDevicePublicKey: Hex;
  }): Promise<SocialRecoverySession> {
    const guardians = await this.getGuardians(params.address);
    
    if (guardians.length < this.minGuardians) {
      throw new Error(`Need at least ${this.minGuardians} guardians`);
    }
    
    // Create recovery session
    const session = await this.createSession(params);
    
    // Notify all guardians
    await Promise.all(
      guardians.map(g => this.requestApproval(g.address, session.id))
    );
    
    return session;
  }
  
  /**
   * Guardian approves recovery request
   */
  async approveRecovery(params: {
    guardian: Address;
    sessionId: string;
    signature: Hex;
  }): Promise<void> {
    // Verify guardian signature
    // Record approval
    // Check if threshold reached
    const session = await this.getSession(params.sessionId);
    
    if (session.approvals >= this.requiredApprovals) {
      // Trigger MPC recovery
      await this.mpcService.initiateRecovery({
        address: session.address,
        newDevicePublicKey: session.newDevicePublicKey,
      });
    }
  }
}
```

## Acceptance Criteria

- [ ] Recovery shares can be distributed to MPC nodes
- [ ] User share is encrypted with backup password
- [ ] Recovery works with correct password
- [ ] Recovery works with correct security answers
- [ ] Social recovery via guardians works
- [ ] Recovered key can be used for XMTP
- [ ] Old key is revoked after recovery

## Output Files

1. `packages/messaging/src/mpc/recovery-service.ts`
2. `packages/messaging/src/mpc/node-handler.ts`
3. `packages/messaging/src/mpc/social-recovery.ts`
4. `packages/messaging/src/mpc/index.ts`
5. `packages/oauth3/src/react/components/RecoveryFlow.tsx`
6. `packages/oauth3/src/react/hooks/useMPCRecovery.ts`

## Testing

```typescript
describe('MPC Recovery', () => {
  test('sets up recovery with password');
  test('sets up recovery with security questions');
  test('recovers with correct password');
  test('fails recovery with wrong password');
  test('recovers with correct security answers');
  test('social recovery with guardian approvals');
  test('recovered key works with XMTP');
});
```

## Commands

```bash
cd packages/messaging

# Run MPC tests (requires MPC nodes or mock)
MPC_MOCK=true bun test src/mpc/*.test.ts

# Type check
bun run typecheck
```

