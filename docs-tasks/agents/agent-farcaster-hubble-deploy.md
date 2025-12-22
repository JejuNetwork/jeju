# Agent Task: Hubble Testnet Infrastructure Deployment

## Priority: P0
## Estimated Time: 2-3 days
## Dependencies: packages/deployment

## Objective

Deploy and configure Farcaster Hubble nodes for testnet, enabling full permissionless Farcaster integration without mainnet costs. This includes bootstrap node, sync configuration, and monitoring.

## Background

Hubble is the reference Farcaster Hub implementation. We need:
- Self-hosted Hub for message submission
- Testnet configuration (cheaper testing)
- Integration with Jeju infrastructure
- Monitoring and alerting

## Source Files to Analyze

- `packages/deployment/kubernetes/helm/farcaster-hubble/` - Existing Helm chart
- Hubble docs: https://docs.farcaster.xyz/hubble/

## Implementation Tasks

### 1. Update Helm Values for Testnet

File: `packages/deployment/kubernetes/helm/farcaster-hubble/values.testnet.yaml`

```yaml
# Farcaster Hubble - Testnet Configuration

replicaCount: 2

image:
  repository: farcasterxyz/hubble
  tag: "1.11.0"  # Latest stable
  pullPolicy: IfNotPresent

# Hub identity (ED25519 key pair)
identity:
  # Generate with: openssl genpkey -algorithm ED25519 -out hub_key.pem
  # Leave empty to auto-generate
  privateKey: ""
  publicKey: ""

# Network configuration
network:
  # Farcaster network ID (1 = mainnet, 2 = testnet)
  id: 2
  
  # Ethereum RPC for ID/Key registries (Optimism Sepolia for testnet)
  ethRpcUrl: "https://sepolia.optimism.io"
  
  # Optimism Mainnet RPC for production
  # ethRpcUrl: "https://mainnet.optimism.io"
  
  # Bootstrap peers (official Farcaster peers)
  bootstrapPeers:
    - "/dns/testnet.farcaster.xyz/tcp/2282"
  
  # Port configuration
  gossipPort: 2282
  rpcPort: 2283
  httpPort: 2281

# Database configuration
database:
  # RocksDB data directory
  dataDir: /home/hubble/data
  # Enable pruning for older messages
  prune: true
  pruneEventsOlderThanDays: 30

# Sync configuration
sync:
  # Start from this FID (0 = from beginning)
  startFid: 0
  # Sync batch size
  batchSize: 1000
  # Parallel sync workers
  workers: 4

# Resource limits
resources:
  requests:
    cpu: "500m"
    memory: "2Gi"
  limits:
    cpu: "2000m"
    memory: "8Gi"

# Persistence
persistence:
  enabled: true
  size: 100Gi
  storageClass: "ssd"

# Service configuration
service:
  type: ClusterIP
  gossip:
    port: 2282
  rpc:
    port: 2283
  http:
    port: 2281

# Ingress for HTTP API
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
  hosts:
    - host: hub.testnet.jeju.network
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: hub-testnet-tls
      hosts:
        - hub.testnet.jeju.network

# Monitoring
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    interval: 30s
  grafanaDashboard:
    enabled: true

# Jeju integration
jeju:
  enabled: true
  # Index events for Jeju apps
  indexer:
    enabled: true
    kafkaBrokers: "kafka.jeju-system:9092"
    topic: "farcaster-events"
  # Sync Jeju identities
  identitySync:
    enabled: true
    registryAddress: "0x..."
```

### 2. Deployment Script

File: `scripts/deploy/farcaster-hub.ts`

```typescript
/**
 * Deploy Farcaster Hubble to Kubernetes
 */

import { $ } from 'bun';
import { parseArgs } from 'util';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    network: { type: 'string', default: 'testnet' },
    dryRun: { type: 'boolean', default: false },
    upgrade: { type: 'boolean', default: false },
  },
});

const NAMESPACE = 'farcaster';
const RELEASE_NAME = 'hubble';
const CHART_PATH = 'packages/deployment/kubernetes/helm/farcaster-hubble';

async function main() {
  console.log(`Deploying Farcaster Hubble to ${values.network}...`);
  
  // Validate network
  if (!['testnet', 'mainnet', 'localnet'].includes(values.network!)) {
    throw new Error('Invalid network. Use testnet, mainnet, or localnet');
  }
  
  // Create namespace if not exists
  await $`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;
  
  // Generate identity if not exists
  const secretExists = await $`kubectl get secret hubble-identity -n ${NAMESPACE} --ignore-not-found`.text();
  if (!secretExists.trim()) {
    console.log('Generating Hub identity...');
    await generateHubIdentity();
  }
  
  // Build values file path
  const valuesFile = `${CHART_PATH}/values.${values.network}.yaml`;
  
  // Helm command
  const helmCmd = values.upgrade ? 'upgrade' : 'install';
  const dryRunFlag = values.dryRun ? '--dry-run' : '';
  
  // Deploy/upgrade
  await $`helm ${helmCmd} ${RELEASE_NAME} ${CHART_PATH} \
    --namespace ${NAMESPACE} \
    --values ${valuesFile} \
    --set image.tag=latest \
    --wait \
    --timeout 10m \
    ${dryRunFlag}`;
  
  console.log('Deployment complete.');
  
  // Print status
  if (!values.dryRun) {
    await printStatus();
  }
}

async function generateHubIdentity() {
  // Generate ED25519 key pair
  const { privateKey, publicKey } = await import('crypto').then(crypto => {
    const keyPair = crypto.generateKeyPairSync('ed25519');
    return {
      privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    };
  });
  
  // Create Kubernetes secret
  await $`kubectl create secret generic hubble-identity \
    --namespace ${NAMESPACE} \
    --from-literal=private-key="${privateKey}" \
    --from-literal=public-key="${publicKey}"`;
  
  console.log('Hub identity created.');
}

async function printStatus() {
  console.log('\nHub Status:');
  await $`kubectl get pods -n ${NAMESPACE} -l app=hubble`;
  
  console.log('\nServices:');
  await $`kubectl get svc -n ${NAMESPACE}`;
  
  console.log('\nIngress:');
  await $`kubectl get ingress -n ${NAMESPACE}`;
  
  console.log('\nTo check hub info:');
  console.log(`curl https://hub.testnet.jeju.network/v1/info`);
}

main().catch(console.error);
```

### 3. Local Development Docker Compose

File: `packages/farcaster/docker-compose.yml`

```yaml
version: '3.8'

services:
  hubble:
    image: farcasterxyz/hubble:latest
    container_name: farcaster-hubble
    ports:
      - "2281:2281"  # HTTP API
      - "2282:2282"  # Gossip
      - "2283:2283"  # gRPC
    volumes:
      - hubble-data:/home/hubble/data
      - ./hub-config:/home/hubble/config
    environment:
      - FC_NETWORK_ID=2  # Testnet
      - ETH_RPC_URL=https://sepolia.optimism.io
      - HUB_OPERATOR_FID=${HUB_OPERATOR_FID:-0}
    command: |
      node
      --network 2
      --eth-mainnet-rpc-url https://sepolia.optimism.io
      --hub-operator-fid ${HUB_OPERATOR_FID:-0}
      --http-api-port 2281
      --gossip-port 2282
      --rpc-port 2283
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:2281/v1/info"]
      interval: 30s
      timeout: 10s
      retries: 5

  # Optional: Hubble web dashboard
  hubble-web:
    image: nginx:alpine
    container_name: hubble-web
    ports:
      - "8080:80"
    volumes:
      - ./hubble-dashboard:/usr/share/nginx/html
    depends_on:
      - hubble

volumes:
  hubble-data:
```

### 4. Integration Test Script

File: `packages/farcaster/scripts/test-hub.ts`

```typescript
/**
 * Test Hubble integration
 */

import { FarcasterClient } from '../src/hub/client';
import { FarcasterPoster } from '../src/hub/poster';
import { ed25519 } from '@noble/curves/ed25519';

const HUB_URL = process.env.HUB_URL ?? 'http://localhost:2281';
const TEST_FID = parseInt(process.env.TEST_FID ?? '12345');

async function main() {
  console.log(`Testing hub at ${HUB_URL}...`);
  
  // Test 1: Hub info
  console.log('\n1. Getting hub info...');
  const client = new FarcasterClient({ hubUrl: HUB_URL });
  const info = await client.getHubInfo();
  console.log('Hub info:', info);
  
  // Test 2: Get user data
  console.log('\n2. Getting user data...');
  if (TEST_FID > 0) {
    const userData = await client.getUserDataByFid(TEST_FID);
    console.log('User data:', userData);
  }
  
  // Test 3: Submit test message (if we have a signer)
  if (process.env.SIGNER_PRIVATE_KEY) {
    console.log('\n3. Submitting test cast...');
    const signerKey = hexToBytes(process.env.SIGNER_PRIVATE_KEY);
    
    const poster = new FarcasterPoster({
      fid: TEST_FID,
      signerPrivateKey: signerKey,
      hubUrl: HUB_URL,
      network: 'testnet',
    });
    
    const result = await poster.cast('Test cast from Jeju Hub integration');
    console.log('Cast submitted:', result);
  }
  
  console.log('\nAll tests passed.');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

### 5. Monitoring Dashboard

File: `packages/deployment/kubernetes/helm/farcaster-hubble/dashboards/hubble.json`

```json
{
  "title": "Farcaster Hubble",
  "panels": [
    {
      "title": "Messages Received",
      "type": "graph",
      "targets": [
        {
          "expr": "rate(hubble_messages_received_total[5m])",
          "legendFormat": "{{type}}"
        }
      ]
    },
    {
      "title": "Sync Progress",
      "type": "gauge",
      "targets": [
        {
          "expr": "hubble_sync_progress_percentage"
        }
      ]
    },
    {
      "title": "Connected Peers",
      "type": "stat",
      "targets": [
        {
          "expr": "hubble_connected_peers"
        }
      ]
    },
    {
      "title": "RocksDB Size",
      "type": "graph",
      "targets": [
        {
          "expr": "hubble_rocksdb_size_bytes"
        }
      ]
    },
    {
      "title": "Memory Usage",
      "type": "graph",
      "targets": [
        {
          "expr": "container_memory_usage_bytes{pod=~\"hubble.*\"}"
        }
      ]
    },
    {
      "title": "CPU Usage",
      "type": "graph",
      "targets": [
        {
          "expr": "rate(container_cpu_usage_seconds_total{pod=~\"hubble.*\"}[5m])"
        }
      ]
    }
  ]
}
```

## Acceptance Criteria

- [ ] Helm chart deploys successfully to testnet
- [ ] Hub syncs with Farcaster network
- [ ] HTTP API accessible via ingress
- [ ] Messages can be submitted and retrieved
- [ ] Monitoring dashboard works
- [ ] Local docker-compose works for development
- [ ] Integration tests pass

## Output Files

1. `packages/deployment/kubernetes/helm/farcaster-hubble/values.testnet.yaml`
2. `packages/deployment/kubernetes/helm/farcaster-hubble/values.localnet.yaml`
3. `scripts/deploy/farcaster-hub.ts`
4. `packages/farcaster/docker-compose.yml`
5. `packages/farcaster/scripts/test-hub.ts`
6. `packages/deployment/kubernetes/helm/farcaster-hubble/dashboards/hubble.json`

## Commands

```bash
# Deploy to testnet
bun scripts/deploy/farcaster-hub.ts --network testnet

# Local development
cd packages/farcaster
docker-compose up -d

# Test hub
HUB_URL=http://localhost:2281 bun scripts/test-hub.ts

# Check hub status
curl http://localhost:2281/v1/info
```

