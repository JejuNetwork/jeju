# Storage

Storage is Jeju's decentralized storage marketplace. It provides a unified API for uploading, pinning, and retrieving content across multiple backends — IPFS for decentralized storage, Arweave for permanent storage, and cloud for high-availability backup.

**URLs:** Localnet at http://127.0.0.1:4010, testnet at https://storage-testnet.jeju.network, mainnet at https://storage.jeju.network

## Storage Providers

### IPFS (Default)

IPFS is a peer-to-peer network for storing and sharing content. Content is split into blocks and distributed across nodes. Each piece of content gets a unique CID (Content Identifier) derived from its hash — same content always produces the same CID. Anyone with the CID can retrieve the content.

IPFS is decentralized and provides content deduplication, but content disappears if no one pins it.

### Arweave (Permanent)

Arweave stores data permanently with a one-time payment. Pay once based on file size and content is stored for 200+ years. Miners are incentivized to store data long-term. The data is immutable and cannot be deleted.

Use Arweave for legal documents, NFT metadata, historical records, and anything that must never change.

### Cloud (Backup)

Cloud storage provides high-availability backup with traditional infrastructure. It offers very fast retrieval and high availability but is centralized with ongoing costs.

Use Cloud for performance-critical content and as a backup alongside IPFS.

## Uploading Content

### Via API

```bash
curl -X POST http://localhost:4010/api/upload \
  -F "file=@document.pdf"
```

Response includes the CID, file size, providers used, and public URL.

### With Options

```bash
curl -X POST http://localhost:4010/api/upload \
  -F "file=@document.pdf" \
  -F "providers=ipfs,arweave" \
  -F "pin=true" \
  -F "metadata={\"name\": \"Important Doc\", \"tags\": [\"legal\"]}"
```

### Via SDK

```typescript
import { StorageClient } from '@jeju/storage-sdk';

const storage = new StorageClient({
  endpoint: 'https://storage.jeju.network',
  wallet,
});

// Upload with auto-routing
const result = await storage.upload(file);

// Upload with specific options
const result = await storage.upload(file, {
  providers: ['ipfs', 'arweave'],
  pin: true,
  metadata: { name: 'Important Document', category: 'legal' },
});
```

### Upload Flow

When you upload, the API analyzes the file (size, type, options), selects providers based on routing rules, uploads to each provider, and returns the CID with metadata.

## Retrieving Content

### Via Gateway (Public)

Anyone can retrieve content via the public gateway at `https://storage.jeju.network/ipfs/{cid}` or with a path at `https://storage.jeju.network/ipfs/{cid}/{path}`.

### Via API

```bash
curl http://localhost:4010/api/content/QmX8B3jD5F... -o file.pdf
```

### Via SDK

```typescript
const content = await storage.get('QmX8B3jD5F...');
// Returns ReadableStream

await storage.download('QmX8B3jD5F...', './local-file.pdf');
```

## Pinning

Pinning keeps content available on the network. Without pinning, IPFS content may eventually be garbage collected by nodes that need space.

### Pin Content

```bash
curl -X POST http://localhost:4010/api/pin \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmX8B3jD5F..."}'
```

### List Pins

```bash
curl http://localhost:4010/api/pins
```

Returns all pinned content with CIDs, names, sizes, pin times, and providers.

### Unpin

```bash
curl -X DELETE http://localhost:4010/api/pin/QmX8B3jD5F...
```

Unpinning doesn't delete content immediately — it just stops guaranteeing availability.

## Auto-Routing

The Storage API automatically selects the best providers based on your needs. Small files under 1MB typically go to IPFS only. NFT metadata and legal documents go to IPFS plus Arweave for permanence. Performance-critical content goes to IPFS plus Cloud for fast retrieval.

Override auto-routing by specifying providers explicitly:

```typescript
await storage.upload(file, {
  providers: ['arweave'],  // Only permanent storage
});
```

## Payments

Storage uses x402 micropayments — pay only for what you use.

Upload costs approximately 0.001 USDC per MB. Pinning costs approximately 0.01 USDC per MB per month. Arweave permanent storage costs approximately 0.1 USDC per MB. Retrieval via the public gateway is free.

The first request returns 402 Payment Required with price details. Pay and retry with the X-Payment header. Multi-token payments are supported using any registered token.

## Agent Integration

Crucible agents use Storage for persistent memory and state. When an agent stores memory, it uploads JSON to IPFS, receives a CID, and records that CID in its on-chain state. To retrieve memory, it fetches content by CID from storage.

A2A skills include `upload` for storing content, `get` for retrieving content by CID, `pin` for pinning content, `unpin` for removing pins, and `list_pins` for listing pinned content.

```bash
curl -X POST http://localhost:4010/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "upload",
      "parameters": {
        "content": "{\"memories\": [...], \"context\": {...}}",
        "contentType": "application/json",
        "pin": true
      }
    }
  }'
```

## Running a Storage Node

Provide storage capacity and earn fees.

### Requirements

Nodes need 1 TB storage, 8 GB RAM, 4 CPU cores, 100 Mbps bandwidth, and a stake of 0.05 ETH.

### Starting a Node

```bash
cd apps/storage
bun install

export PRIVATE_KEY=0x...
export IPFS_REPO_PATH=./ipfs-data
export STORAGE_PORT=4010

bun run node
```

### Earnings

Nodes earn from pin fees (monthly fees for keeping content available), retrieval fees (micropayments for serving content when enabled), and storage rewards (network inflation distributed to stakers).

## API Reference

Content endpoints include `/api/upload` (POST) for uploading files, `/api/content/:cid` (GET) for retrieving content, `/ipfs/:cid` (GET) for the public IPFS gateway, and `/ipfs/:cid/*path` (GET) for gateway with path.

Pin endpoints include `/api/pin` (POST) for pinning content, `/api/pins` (GET) for listing pins, and `/api/pin/:cid` (DELETE) for unpinning.

Admin endpoints include `/api/stats` (GET) for storage statistics and `/health` (GET) for health checks.

Agent endpoints include `/a2a` (POST) for Agent-to-Agent and `/mcp` (POST) for Model Context Protocol.

## Setup & Configuration

Install with `cd apps/storage && bun install`.

Configure environment variables: `STORAGE_PORT` for the API port, `IPFS_NODE_URL` for the IPFS node, `IPFS_GATEWAY_URL` for the IPFS gateway, `ARWEAVE_GATEWAY` for Arweave, and optionally `S3_BUCKET` and `S3_REGION` for cloud backup.

Run development with `bun run dev` for API only or `bun run dev:full` for the full stack including IPFS. For production, run `bun run build` then `bun run start`.

## Testing

Run unit tests with `bun run test`. Run integration tests with `bun run test:integration` (requires IPFS node running).

## Deployment

### Localnet

Storage starts automatically with `bun run dev` from the root.

### Testnet/Mainnet

Build and deploy:

```bash
cd apps/storage
bun run build
```

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=storage sync
```

### Storage Node (Provider)

For running as a storage provider, see [Run a Storage Node](/guides/run-storage-node).

### Required Secrets

For the storage API:
- `PRIVATE_KEY` — Wallet for contract interactions
- `ARWEAVE_KEY` — Arweave wallet key for permanent storage
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` — For cloud backup

### Docker

```bash
docker build -t jeju-storage .
docker run -p 4010:4010 \
  -e NETWORK=testnet \
  -e IPFS_NODE_URL=http://ipfs:5001 \
  jeju-storage
```

## Common Issues

"IPFS node not connected" means the local IPFS daemon isn't running. Start it with `ipfs daemon &`.

"Content not found" means content may have been garbage collected. Check if the content is pinned, try a different gateway, or re-upload if you have the original.

"Arweave upload failed" usually means insufficient AR balance, network congestion, or the file is too large (over 100MB).

## Next Steps

- [Run a Storage Node](/guides/run-storage-node) — Become a provider
- [Store Agent Memory](/guides/store-agent-memory) — Use storage with agents
- [IPFS Best Practices](/guides/ipfs-best-practices) — Optimize your storage
