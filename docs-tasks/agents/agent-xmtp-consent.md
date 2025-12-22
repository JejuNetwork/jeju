# Agent Task: Consent and Spam Protection with On-Chain Registry

## Priority: P1
## Estimated Time: 2 days
## Dependencies: agent-xmtp-contracts

## Objective

Build a consent and spam protection system that integrates XMTP's consent protocol with an on-chain registry, providing users control over who can message them while enabling network-level enforcement.

## Background

XMTP has a consent protocol for allowing/blocking senders. We extend this with:
- On-chain consent registry for permanent, verifiable consent
- Network-level enforcement via relay nodes
- Consent history for dispute resolution
- Reputation scoring for senders

## Source Files to Analyze

- `packages/messaging/src/sdk/client.ts` - Messaging client
- `packages/messaging/contracts/MessageNodeRegistry.sol` - Node registry
- XMTP SDK consent APIs

## Implementation Tasks

### 1. Consent Registry Contract

File: `packages/messaging/contracts/ConsentRegistry.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ConsentRegistry
 * @notice On-chain consent management for messaging
 * @dev Stores allow/block lists and consent history
 */
contract ConsentRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;
    
    // ============ Structs ============
    
    struct ConsentRecord {
        address sender;
        ConsentType consentType;
        uint256 timestamp;
        bytes32 reason; // Optional reason hash
    }
    
    enum ConsentType { UNKNOWN, ALLOWED, BLOCKED, REQUESTED }
    
    // ============ State ============
    
    // Owner => allowed senders
    mapping(address => EnumerableSet.AddressSet) private allowedSenders;
    
    // Owner => blocked senders
    mapping(address => EnumerableSet.AddressSet) private blockedSenders;
    
    // Owner => pending requests
    mapping(address => EnumerableSet.AddressSet) private pendingRequests;
    
    // Consent history (owner => sender => records)
    mapping(address => mapping(address => ConsentRecord[])) public consentHistory;
    
    // Default consent mode (true = allowlist, false = blocklist)
    mapping(address => bool) public defaultDeny;
    
    // Reputation scores (sender => score)
    mapping(address => int256) public reputationScore;
    
    // ============ Events ============
    
    event ConsentGranted(address indexed owner, address indexed sender, uint256 timestamp);
    event ConsentRevoked(address indexed owner, address indexed sender, uint256 timestamp);
    event SenderBlocked(address indexed owner, address indexed sender, bytes32 reason);
    event ConsentRequested(address indexed owner, address indexed sender);
    event DefaultModeChanged(address indexed owner, bool defaultDeny);
    
    // ============ Consent Management ============
    
    /**
     * @notice Allow a sender to message you
     */
    function allowSender(address sender) external {
        require(sender != address(0), "Invalid sender");
        require(sender != msg.sender, "Cannot allow self");
        
        allowedSenders[msg.sender].add(sender);
        blockedSenders[msg.sender].remove(sender);
        pendingRequests[msg.sender].remove(sender);
        
        _recordConsent(msg.sender, sender, ConsentType.ALLOWED, bytes32(0));
        
        emit ConsentGranted(msg.sender, sender, block.timestamp);
    }
    
    /**
     * @notice Block a sender
     */
    function blockSender(address sender, bytes32 reason) external {
        require(sender != address(0), "Invalid sender");
        
        blockedSenders[msg.sender].add(sender);
        allowedSenders[msg.sender].remove(sender);
        pendingRequests[msg.sender].remove(sender);
        
        // Decrease sender's reputation
        reputationScore[sender] -= 1;
        
        _recordConsent(msg.sender, sender, ConsentType.BLOCKED, reason);
        
        emit SenderBlocked(msg.sender, sender, reason);
    }
    
    /**
     * @notice Request consent to message someone
     */
    function requestConsent(address recipient) external {
        require(recipient != address(0), "Invalid recipient");
        require(!blockedSenders[recipient].contains(msg.sender), "You are blocked");
        
        if (!allowedSenders[recipient].contains(msg.sender)) {
            pendingRequests[recipient].add(msg.sender);
            emit ConsentRequested(recipient, msg.sender);
        }
    }
    
    /**
     * @notice Batch allow multiple senders
     */
    function allowSenders(address[] calldata senders) external {
        for (uint256 i = 0; i < senders.length; i++) {
            if (senders[i] != address(0) && senders[i] != msg.sender) {
                allowedSenders[msg.sender].add(senders[i]);
                blockedSenders[msg.sender].remove(senders[i]);
                emit ConsentGranted(msg.sender, senders[i], block.timestamp);
            }
        }
    }
    
    /**
     * @notice Set default consent mode
     */
    function setDefaultDeny(bool _defaultDeny) external {
        defaultDeny[msg.sender] = _defaultDeny;
        emit DefaultModeChanged(msg.sender, _defaultDeny);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Check if sender can message recipient
     */
    function canMessage(address sender, address recipient) external view returns (bool) {
        // Explicit block always denies
        if (blockedSenders[recipient].contains(sender)) {
            return false;
        }
        
        // Explicit allow always permits
        if (allowedSenders[recipient].contains(sender)) {
            return true;
        }
        
        // Check default mode
        if (defaultDeny[recipient]) {
            return false; // Not explicitly allowed = denied
        }
        
        // Default allow mode: anyone not blocked can message
        return true;
    }
    
    /**
     * @notice Get consent type for a sender
     */
    function getConsentType(address owner, address sender) 
        external view returns (ConsentType) 
    {
        if (blockedSenders[owner].contains(sender)) return ConsentType.BLOCKED;
        if (allowedSenders[owner].contains(sender)) return ConsentType.ALLOWED;
        if (pendingRequests[owner].contains(sender)) return ConsentType.REQUESTED;
        return ConsentType.UNKNOWN;
    }
    
    /**
     * @notice Get all allowed senders for an address
     */
    function getAllowedSenders(address owner) 
        external view returns (address[] memory) 
    {
        return allowedSenders[owner].values();
    }
    
    /**
     * @notice Get all blocked senders for an address
     */
    function getBlockedSenders(address owner) 
        external view returns (address[] memory) 
    {
        return blockedSenders[owner].values();
    }
    
    /**
     * @notice Get pending consent requests
     */
    function getPendingRequests(address owner) 
        external view returns (address[] memory) 
    {
        return pendingRequests[owner].values();
    }
    
    /**
     * @notice Get consent history for a sender
     */
    function getConsentHistory(address owner, address sender) 
        external view returns (ConsentRecord[] memory) 
    {
        return consentHistory[owner][sender];
    }
    
    // ============ Internal ============
    
    function _recordConsent(
        address owner,
        address sender,
        ConsentType consentType,
        bytes32 reason
    ) internal {
        consentHistory[owner][sender].push(ConsentRecord({
            sender: sender,
            consentType: consentType,
            timestamp: block.timestamp,
            reason: reason
        }));
    }
}
```

### 2. Consent SDK Client

File: `packages/messaging/src/consent/client.ts`

```typescript
/**
 * Consent Management Client
 * 
 * Provides consent management that syncs between XMTP and on-chain.
 */

import type { Address, Hex } from 'viem';
import type { Client as XMTPClient } from '@xmtp/xmtp-js';

export type ConsentType = 'unknown' | 'allowed' | 'blocked' | 'requested';

export interface ConsentState {
  address: Address;
  type: ConsentType;
  timestamp: number;
  source: 'xmtp' | 'chain' | 'local';
}

export interface ConsentConfig {
  registryAddress: Address;
  wallet: WalletClient;
  xmtpClient?: XMTPClient;
  syncToChain: boolean;
}

export class ConsentClient {
  private registry: ConsentRegistry;
  private xmtp?: XMTPClient;
  private localCache: Map<Address, ConsentState> = new Map();
  
  constructor(private config: ConsentConfig) {
    this.registry = new ConsentRegistry(config.registryAddress, config.wallet);
    this.xmtp = config.xmtpClient;
  }
  
  /**
   * Allow a sender
   */
  async allow(address: Address): Promise<void> {
    // Update local cache
    this.localCache.set(address, {
      address,
      type: 'allowed',
      timestamp: Date.now(),
      source: 'local',
    });
    
    // Sync to XMTP
    if (this.xmtp) {
      await this.xmtp.contacts.allow([address]);
    }
    
    // Sync to chain (if enabled)
    if (this.config.syncToChain) {
      await this.registry.allowSender(address);
    }
  }
  
  /**
   * Block a sender
   */
  async block(address: Address, reason?: string): Promise<void> {
    const reasonHash = reason 
      ? keccak256(toBytes(reason))
      : '0x' + '0'.repeat(64) as Hex;
    
    // Update local cache
    this.localCache.set(address, {
      address,
      type: 'blocked',
      timestamp: Date.now(),
      source: 'local',
    });
    
    // Sync to XMTP
    if (this.xmtp) {
      await this.xmtp.contacts.deny([address]);
    }
    
    // Sync to chain
    if (this.config.syncToChain) {
      await this.registry.blockSender(address, reasonHash);
    }
  }
  
  /**
   * Check if can message
   */
  async canMessage(address: Address): Promise<boolean> {
    // Check local cache first
    const cached = this.localCache.get(address);
    if (cached) {
      return cached.type === 'allowed';
    }
    
    // Check on-chain
    return this.registry.canMessage(this.config.wallet.account.address, address);
  }
  
  /**
   * Get consent state for address
   */
  async getConsentState(address: Address): Promise<ConsentState> {
    // Check local cache
    const cached = this.localCache.get(address);
    if (cached) return cached;
    
    // Check on-chain
    const onChain = await this.registry.getConsentType(
      this.config.wallet.account.address,
      address,
    );
    
    return {
      address,
      type: onChain,
      timestamp: Date.now(),
      source: 'chain',
    };
  }
  
  /**
   * Get all allowed senders
   */
  async getAllowed(): Promise<Address[]> {
    return this.registry.getAllowedSenders(this.config.wallet.account.address);
  }
  
  /**
   * Get all blocked senders
   */
  async getBlocked(): Promise<Address[]> {
    return this.registry.getBlockedSenders(this.config.wallet.account.address);
  }
  
  /**
   * Get pending consent requests
   */
  async getPendingRequests(): Promise<Address[]> {
    return this.registry.getPendingRequests(this.config.wallet.account.address);
  }
  
  /**
   * Request consent to message someone
   */
  async requestConsent(recipient: Address): Promise<void> {
    await this.registry.requestConsent(recipient);
  }
  
  /**
   * Sync local state with on-chain
   */
  async sync(): Promise<void> {
    const [allowed, blocked] = await Promise.all([
      this.getAllowed(),
      this.getBlocked(),
    ]);
    
    for (const addr of allowed) {
      this.localCache.set(addr, {
        address: addr,
        type: 'allowed',
        timestamp: Date.now(),
        source: 'chain',
      });
    }
    
    for (const addr of blocked) {
      this.localCache.set(addr, {
        address: addr,
        type: 'blocked',
        timestamp: Date.now(),
        source: 'chain',
      });
    }
  }
}
```

### 3. Relay Node Consent Enforcement

File: `packages/messaging/src/node/consent-filter.ts`

```typescript
/**
 * Consent Filter for Relay Nodes
 * 
 * Enforces consent rules at the network level.
 */

import type { Address } from 'viem';
import type { MessageEnvelope } from '../schemas';

export interface ConsentFilterConfig {
  registryAddress: Address;
  rpcUrl: string;
  cacheEnabled: boolean;
  cacheTTL: number; // seconds
}

export class ConsentFilter {
  private cache: Map<string, { allowed: boolean; expiry: number }> = new Map();
  private registry: PublicClient;
  
  constructor(private config: ConsentFilterConfig) {
    this.registry = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }
  
  /**
   * Check if message should be relayed
   */
  async shouldRelay(envelope: MessageEnvelope): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const cacheKey = `${envelope.from}:${envelope.to}`;
    
    // Check cache
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return { allowed: cached.allowed };
      }
    }
    
    // Check on-chain consent
    const allowed = await this.registry.readContract({
      address: this.config.registryAddress,
      abi: CONSENT_REGISTRY_ABI,
      functionName: 'canMessage',
      args: [envelope.from, envelope.to],
    });
    
    // Update cache
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, {
        allowed,
        expiry: Date.now() + this.config.cacheTTL * 1000,
      });
    }
    
    if (!allowed) {
      return {
        allowed: false,
        reason: 'Sender not in recipient consent list',
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Invalidate cache entry
   */
  invalidateCache(sender: Address, recipient: Address): void {
    this.cache.delete(`${sender}:${recipient}`);
  }
  
  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
```

### 4. Update Relay Server

File: `packages/messaging/src/node/server.ts` (update)

```typescript
// Add consent filtering to relay server

export function createRelayServer(config: NodeConfig): Hono {
  const app = new Hono();
  const consentFilter = new ConsentFilter({
    registryAddress: config.consentRegistryAddress,
    rpcUrl: config.rpcUrl,
    cacheEnabled: true,
    cacheTTL: 60, // 1 minute cache
  });
  
  // ... existing setup ...
  
  app.post('/send', async (c) => {
    const envelope = await c.req.json();
    
    // Validate envelope
    const parseResult = MessageEnvelopeSchema.safeParse(envelope);
    if (!parseResult.success) {
      return c.json({ success: false, error: 'Invalid envelope' }, 400);
    }
    
    // Check consent
    const consentCheck = await consentFilter.shouldRelay(parseResult.data);
    if (!consentCheck.allowed) {
      return c.json({ 
        success: false, 
        error: 'Message blocked by consent',
        reason: consentCheck.reason,
      }, 403);
    }
    
    // ... existing message handling ...
  });
  
  return app;
}
```

## Acceptance Criteria

- [ ] Consent registry contract deployed
- [ ] Allow/block operations work on-chain
- [ ] Consent requests work
- [ ] Relay nodes enforce consent
- [ ] XMTP consent synced with on-chain
- [ ] Consent history queryable
- [ ] Reputation scoring updates

## Output Files

1. `packages/messaging/contracts/ConsentRegistry.sol`
2. `packages/messaging/src/consent/client.ts`
3. `packages/messaging/src/consent/index.ts`
4. `packages/messaging/src/node/consent-filter.ts`
5. `packages/messaging/src/node/server.ts` (update)

## Testing

```typescript
describe('Consent Registry', () => {
  test('allows sender');
  test('blocks sender');
  test('checks canMessage correctly');
  test('records consent history');
  test('relay node enforces consent');
  test('syncs XMTP consent to chain');
});
```

## Commands

```bash
# Deploy consent registry
cd packages/messaging
forge script script/DeployConsentRegistry.s.sol --rpc-url http://localhost:9545 --broadcast

# Run tests
bun test src/consent/*.test.ts
forge test --match-contract ConsentRegistry -vvv
```

