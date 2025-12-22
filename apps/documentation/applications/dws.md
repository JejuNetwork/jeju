# DWS (Decentralized Web Services)

Compute, storage, and CDN in one package.

## What It Does

| Service | Description |
|---------|-------------|
| **Compute** | GPU rental, AI inference |
| **Storage** | IPFS upload, pinning |
| **CDN** | Edge caching, JNS gateway |

## Quick Start

### Using the SDK

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Upload a file
const cid = await jeju.storage.upload(file);
console.log('CID:', cid);

// Run inference
const result = await jeju.compute.inference({
  model: 'llama3.2',
  prompt: 'Hello',
});
console.log(result.text);

// Rent GPU
const rental = await jeju.compute.createRental({
  provider: providerAddress,
  durationHours: 2,
});
```

### Running DWS Locally

```bash
cd apps/dws
bun install
bun run dev
```

Runs on http://localhost:4007

## Storage

### Upload

```typescript
const cid = await jeju.storage.upload(file);
```

### Pin

```typescript
await jeju.storage.pin(cid, {
  duration: 30 * 24 * 60 * 60, // 30 days
});
```

### Download

```typescript
const data = await jeju.storage.get(cid);
```

### Check Status

```typescript
const pins = await jeju.storage.listPins();
```

## Compute

### List Providers

```typescript
const providers = await jeju.compute.listProviders();
```

### List Models

```typescript
const models = await jeju.compute.listModels();
```

### Run Inference

```typescript
const result = await jeju.compute.inference({
  model: 'llama3.2',
  prompt: 'Explain DeFi',
  maxTokens: 100,
});
```

### Rent GPU

```typescript
const rental = await jeju.compute.createRental({
  provider: '0x...',
  durationHours: 2,
});

// End early
await jeju.compute.endRental(rental.id);
```

## CDN

DWS includes edge caching and a JNS gateway.

### JNS Gateway

Access content via `.jeju` domains:

```
https://myapp.jeju.network/
```

### Edge Nodes

Content is cached at edge nodes for low latency.

## Running a Node

See [Compute Node](/operate/compute-node) and [Storage Node](/operate/storage-node).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/storage/upload` | POST | Upload file |
| `/storage/:cid` | GET | Download file |
| `/storage/pin` | POST | Pin CID |
| `/compute/inference` | POST | Run inference |
| `/compute/providers` | GET | List providers |
| `/health` | GET | Health check |

## Environment Variables

```bash
NETWORK=localnet
RPC_URL=http://127.0.0.1:9545
PRIVATE_KEY=0x...
STORAGE_PATH=/data/ipfs
COMPUTE_GPU_ENABLED=true
```

---

<details>
<summary>📋 Copy as Context</summary>

```
DWS - Decentralized Web Services

Services: Compute + Storage + CDN

Storage:
await jeju.storage.upload(file) → cid
await jeju.storage.pin(cid, { duration })
await jeju.storage.get(cid)

Compute:
await jeju.compute.listProviders()
await jeju.compute.listModels()
await jeju.compute.inference({ model: 'llama3.2', prompt })
await jeju.compute.createRental({ provider, durationHours })

Run locally:
cd apps/dws && bun run dev
Port: 4007

API:
POST /storage/upload
GET /storage/:cid
POST /storage/pin
POST /compute/inference
GET /compute/providers
```

</details>
