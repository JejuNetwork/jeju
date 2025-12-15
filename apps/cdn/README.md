# Jeju CDN - Decentralized Content Delivery Network

A permissionless CDN with edge nodes run by operators and JNS gateway (like eth.link for ENS).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        apps/cdn (this package)                       │
│  - Edge node code (runs on operator nodes + cloud)                  │
│  - JNS Gateway (*.jns.jeju.network resolution)                      │
│  - Coordinator (routing, settlements)                               │
│  - NO vendor-specific code                                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              packages/deployment/terraform/modules/cdn               │
│  - CloudFront distributions                                         │
│  - S3 buckets for caching                                           │
│  - WAF rules                                                        │
│  - Route53 DNS                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        vendor/cloud                                  │
│  - Cloud integration pass-through                                   │
│  - AWS/GCP service wrappers                                         │
│  - Deployed alongside edge nodes                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

- **JNS Gateway**: Like eth.link for ENS - resolve myapp.jns.jeju.network
- **Vercel-style Caching**: Smart TTL defaults based on content type and paths
- **Geo-Based Routing**: Route requests to the nearest healthy edge node
- **Cache Invalidation**: Propagate cache purges across all edge nodes
- **Usage-Based Billing**: Fair pricing with on-chain settlement
- **ERC-8004 Integration**: Identity verification for node operators

## Quick Start

### Running an Edge Node

```bash
# Set environment variables
export PRIVATE_KEY=your_private_key
export CDN_PORT=4020
export CDN_REGION=us-east-1
export IPFS_GATEWAY_URL=https://ipfs.io

# Start edge node
bun run edge-node
```

### Running the JNS Gateway

```bash
# JNS Gateway (like eth.link)
export JNS_GATEWAY_PORT=4022
export JNS_REGISTRY_ADDRESS=0x...
export IPFS_GATEWAY_URL=https://ipfs.io
bun run jns-gateway
```

### Running the Coordinator

```bash
export CDN_COORDINATOR_PORT=4021
bun run coordinator
```

### Using the SDK

```typescript
import { CDNClient } from '@jeju/cdn';

const cdn = new CDNClient({
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: 'https://rpc.jeju.network',
});

// Deploy a frontend
const deployment = await cdn.deploy({
  domain: 'myapp.jns.eth',
  buildDir: './dist',
  framework: 'next',
  warmup: true,
});

console.log(`Deployed to ${deployment.cdnUrl}`);

// Invalidate cache
await cdn.invalidate(deployment.siteId, ['/', '/api/*']);
```

## Architecture

```
                    ┌──────────────────┐
                    │   Coordinator    │
                    │  (Routing/Mgmt)  │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
   ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
   │ Edge Node │       │ Edge Node │       │ Edge Node │
   │ us-east-1 │       │ eu-west-1 │       │ ap-ne-1   │
   └─────┬─────┘       └─────┬─────┘       └─────┬─────┘
         │                   │                   │
   ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
   │  Origins  │       │  Origins  │       │  Origins  │
   │ IPFS/S3/R2│       │ IPFS/S3/R2│       │ IPFS/S3/R2│
   └───────────┘       └───────────┘       └───────────┘
```

## Infrastructure Providers (via terraform)

These are deployed infrastructure, not code in this package:

### Cloud CDN (packages/deployment/terraform)
- AWS CloudFront - deployed via terraform
- Cloudflare - deployed via terraform
- Route53 DNS

### Decentralized (deployed nodes)
- Fleek Network nodes
- Pipe Network nodes
- AIOZ nodes

### Self-Hosted
- Residential edge nodes (apps/node integration)
- Data center deployments
- Desktop app integration

## Cache Rules (Vercel-style Defaults)

| Content Type | Default TTL | Strategy |
|-------------|-------------|----------|
| `/_next/static/**` | 1 year | Immutable |
| `*.{js,css}` with hash | 1 year | Immutable |
| Fonts | 1 year | Immutable |
| Images | 1 day | Static |
| HTML | 0 (revalidate) | Stale-While-Revalidate |
| API | 1 minute | Dynamic |
| Service Worker | 0 | Always check |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Operator wallet private key | Required |
| `CDN_PORT` | Edge node HTTP port | 4020 |
| `CDN_REGION` | Geographic region | us-east-1 |
| `CDN_CACHE_SIZE_MB` | Max cache size | 512 |
| `CDN_REGISTRY_ADDRESS` | CDN registry contract | - |
| `CDN_BILLING_ADDRESS` | Billing contract | - |
| `IPFS_GATEWAY_URL` | IPFS gateway for origin | - |
| `S3_BUCKET` | S3 bucket for origin | - |
| `R2_BUCKET` | Cloudflare R2 bucket | - |

## API Endpoints

### Edge Node

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node health and metrics |
| `/metrics` | GET | JSON metrics |
| `/metrics/prometheus` | GET | Prometheus format |
| `/invalidate` | POST | Invalidate cache paths |
| `/purge` | POST | Purge all cache |
| `/warmup` | POST | Warmup URLs |
| `/*` | GET | Serve cached content |

### Coordinator

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Coordinator health |
| `/nodes/register` | POST | Register edge node |
| `/nodes/:nodeId/heartbeat` | POST | Node heartbeat |
| `/route` | POST | Get routing decision |
| `/invalidate` | POST | Request invalidation |
| `/regions` | GET | Region statistics |

## Contracts

### CDNRegistry.sol
- Node registration and staking
- Provider capabilities and pricing
- Usage reporting

### CDNBilling.sol  
- Prepaid balance management
- Usage-based billing
- Provider settlements

## Testing

```bash
bun test
```

## License

MIT

