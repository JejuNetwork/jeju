# DWS (Decentralized Web Services)

Decentralized cloud infrastructure - compute, storage, CDN, and more.

## Overview

DWS provides AWS/GCP-like services on a decentralized network:

- **Compute** - Run containers, serverless functions, AI inference
- **Storage** - IPFS-backed object storage with pinning
- **CDN** - Edge caching and content delivery
- **Triggers** - Cron jobs and event-driven execution

All services are payable in JEJU, USDC, or other registered tokens.

## Quick Start

```bash
cd apps/dws
bun install
bun run dev
```

DWS runs on http://localhost:4008

## Features

### Compute

Deploy containers and serverless functions:

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({ network: 'mainnet', privateKey });

// Deploy a container
const container = await jeju.dws.deploy({
  image: 'myapp:latest',
  ports: [3000],
  env: { NODE_ENV: 'production' },
  resources: { cpu: 2, memory: '4Gi' },
});

console.log(`Running at: ${container.url}`);
```

### AI Inference

Run inference on decentralized compute:

```typescript
const result = await jeju.compute.inference({
  model: 'llama3.2',
  prompt: 'Explain cross-chain intents',
  maxTokens: 500,
});
```

### Storage

Upload and pin files to IPFS:

```typescript
// Upload file
const cid = await jeju.storage.upload(file);

// Pin for persistence
await jeju.storage.pin(cid, { duration: 30 * 24 * 60 * 60 }); // 30 days

// Get file
const data = await jeju.storage.get(cid);
```

### CDN

Serve content from edge nodes:

```typescript
// Create CDN distribution
const cdn = await jeju.cdn.create({
  origin: `ipfs://${cid}`,
  domain: 'assets.myapp.jeju',
});
```

### Triggers

Schedule automated tasks:

```typescript
// Cron trigger
await jeju.dws.createTrigger({
  type: 'cron',
  schedule: '0 */6 * * *', // Every 6 hours
  endpoint: 'https://myapp.com/api/sync',
});

// Webhook trigger
await jeju.dws.createTrigger({
  type: 'webhook',
  url: 'https://myapp.com/api/webhook',
  secret: 'my-secret',
});
```

## Pricing

| Service | Price |
|---------|-------|
| Compute (per vCPU-hour) | 0.01 USDC |
| Storage (per GB/month) | 0.02 USDC |
| Bandwidth (per GB) | 0.001 USDC |
| Inference (per 1K tokens) | 0.002 USDC |

## vs. Traditional Cloud

| Feature | DWS | AWS/GCP |
|---------|-----|---------|
| Vendor lock-in | No | Yes |
| Payment | Crypto | Credit card |
| Censorship | Resistant | Subject to ToS |
| Pricing | Transparent | Complex |
| Decentralized | Yes | No |

## Node Operations

Run DWS infrastructure to earn rewards:

```bash
# Start compute node
bun run node

# Start with GPU for inference
GPU_ENABLED=true bun run node
```

Requirements:
- **Compute Node**: 16+ cores, 64GB RAM, 1TB SSD
- **Storage Node**: 8+ cores, 32GB RAM, 10TB storage
- **Edge Node**: 4+ cores, 8GB RAM, low latency

## Development

```bash
bun run dev          # Start server
bun run dev:frontend # Start frontend
bun run test         # Run tests
bun run inference    # Local inference server
```

## Related

- [SDK DWS Module](/build/sdk/dws) - Full SDK documentation
- [Run Compute Node](/operate/compute-node) - Node operator guide
- [Run Storage Node](/operate/storage-node) - Storage provider guide

---

<details>
<summary>📋 Copy as Context</summary>

```
DWS - Decentralized Web Services

Decentralized alternative to AWS/GCP/Azure.

Services:
- Compute: Containers, serverless, AI inference
- Storage: IPFS-backed with pinning
- CDN: Edge caching and delivery
- Triggers: Cron and event-driven execution

SDK Usage:
// Deploy container
const container = await jeju.dws.deploy({
  image: 'myapp:latest',
  ports: [3000],
  resources: { cpu: 2, memory: '4Gi' },
});

// Upload to storage
const cid = await jeju.storage.upload(file);
await jeju.storage.pin(cid, { duration: 30*24*60*60 });

// AI inference
const result = await jeju.compute.inference({
  model: 'llama3.2',
  prompt: 'Explain cross-chain intents',
});

// Create trigger
await jeju.dws.createTrigger({
  type: 'cron',
  schedule: '0 */6 * * *',
  endpoint: 'https://myapp.com/api/sync',
});

Pricing:
- Compute: 0.01 USDC/vCPU-hour
- Storage: 0.02 USDC/GB/month
- Bandwidth: 0.001 USDC/GB
- Inference: 0.002 USDC/1K tokens

Run a node:
bun run node
GPU_ENABLED=true bun run node
```

</details>

