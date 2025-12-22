# Agent Task: XMTP Self-Hosted Network Infrastructure

## Priority: P0
## Estimated Time: 2-3 days
## Dependencies: None

## Objective

Create self-hosted XMTP network infrastructure that integrates with Jeju's existing messaging relay nodes, enabling private group messaging with MLS encryption while using Jeju's decentralized relay network for message transport.

## Background

XMTP uses MLS (Message Layer Security) for group encryption but currently runs centralized nodes. We want to:
1. Use XMTP's MLS protocol for encryption
2. Route messages through Jeju relay nodes
3. Store keys in Jeju's on-chain registries
4. Maintain full decentralization

## Source Files to Analyze

- `packages/messaging/src/node/server.ts` - Existing relay server
- `packages/messaging/src/sdk/client.ts` - Messaging client
- `packages/messaging/contracts/KeyRegistry.sol` - Key storage contract
- `packages/messaging/contracts/MessageNodeRegistry.sol` - Node registry
- `packages/deployment/kubernetes/helm/messaging/` - Helm charts

## Implementation Tasks

### 1. Create XMTP Node Wrapper

File: `packages/messaging/src/xmtp/node.ts`

```typescript
/**
 * XMTP Node Wrapper
 * 
 * Wraps XMTP's MLS functionality with Jeju's relay infrastructure.
 * Messages are encrypted with XMTP/MLS, transported via Jeju nodes.
 */

import { Client as XMTPClient } from '@xmtp/xmtp-js';

export interface XMTPNodeConfig {
  nodeId: string;
  jejuRelayUrl: string;
  ipfsUrl?: string;
  persistenceDir: string;
}

export class JejuXMTPNode {
  // Implement:
  // - Initialize with Jeju relay connection
  // - Forward XMTP messages through Jeju relay
  // - Store message metadata in IPFS
  // - Sync with other Jeju nodes
}
```

### 2. Message Router Integration

File: `packages/messaging/src/xmtp/router.ts`

```typescript
/**
 * Routes XMTP messages through Jeju relay network.
 * 
 * Flow:
 * 1. Client encrypts with XMTP/MLS
 * 2. Router wraps in Jeju envelope
 * 3. Sends to Jeju relay nodes
 * 4. Recipient decrypts with XMTP/MLS
 */

export class XMTPMessageRouter {
  // Implement message routing that:
  // - Uses Jeju relay nodes for transport
  // - Maintains XMTP encryption end-to-end
  // - Supports multi-region relay selection
  // - Handles offline message queuing
}
```

### 3. Docker Compose for Local Development

File: `packages/messaging/docker-compose.xmtp.yml`

```yaml
version: '3.8'
services:
  jeju-xmtp-node:
    build:
      context: .
      dockerfile: Dockerfile.xmtp
    ports:
      - "3200:3200"  # HTTP API
      - "3201:3201"  # WebSocket
    environment:
      - NODE_ID=local-xmtp-1
      - IPFS_URL=http://ipfs:5001
      - JEJU_RPC_URL=http://localnet:9545
    depends_on:
      - ipfs
      
  ipfs:
    image: ipfs/kubo:latest
    ports:
      - "5001:5001"
```

### 4. Helm Chart Updates

Update: `packages/deployment/kubernetes/helm/messaging/templates/`

Add XMTP-specific configuration:
- XMTP node sidecar container
- MLS key persistence volume
- Backup/recovery jobs

### 5. Integration Tests

File: `packages/messaging/src/tests/xmtp-integration.test.ts`

```typescript
describe('XMTP Integration', () => {
  test('creates XMTP identity linked to Jeju address');
  test('sends encrypted message via Jeju relay');
  test('receives message on multiple devices');
  test('group chat with MLS encryption');
  test('message persistence survives node restart');
  test('cross-region message delivery');
});
```

## Acceptance Criteria

- [ ] XMTP node starts and connects to Jeju relay network
- [ ] Messages encrypted with XMTP/MLS are routed through Jeju nodes
- [ ] Node can be deployed via Docker and Helm
- [ ] All integration tests pass
- [ ] Node syncs with IPFS for persistence
- [ ] Metrics exposed for Prometheus

## Output Files

1. `packages/messaging/src/xmtp/node.ts`
2. `packages/messaging/src/xmtp/router.ts`
3. `packages/messaging/src/xmtp/sync.ts`
4. `packages/messaging/docker-compose.xmtp.yml`
5. `packages/messaging/Dockerfile.xmtp`
6. `packages/deployment/kubernetes/helm/messaging/templates/xmtp-*.yaml`
7. `packages/messaging/src/tests/xmtp-integration.test.ts`

## Commands to Run

```bash
# Install XMTP dependencies
cd packages/messaging
bun add @xmtp/xmtp-js @xmtp/mls-client

# Run tests
bun test src/tests/xmtp-integration.test.ts

# Start local node
docker-compose -f docker-compose.xmtp.yml up
```

