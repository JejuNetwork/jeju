# Storage API

Decentralized storage API with BitTorrent/WebTorrent, IPFS, content moderation, and seeding rewards.

## Features

- **Multi-Backend Storage**: IPFS, WebTorrent, Arweave, Cloud (S3/R2/Vercel Blob)
- **Smart Routing**: Automatically routes content via fastest/cheapest path
- **Content Moderation**: CSAM detection, PII scanning, blocklist sync
- **Seeding Rewards**: On-chain reward system for P2P content distribution
- **Encrypted Storage**: KMS integration for private content distribution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     UnifiedStorageSDK                       │
├─────────────────────────────────────────────────────────────┤
│  ContentRouter  │  ModerationService  │  BackendManager     │
├─────────────────────────────────────────────────────────────┤
│  TorrentBackend │  IPFSBackend  │  CloudBackend  │  Local   │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Start the storage API server
bun run dev

# Start the seeding oracle (separate process)
bun run oracle
```

## Environment Variables

```env
PORT=3100
RPC_URL=http://127.0.0.1:9545
PRIVATE_KEY=<your-private-key>
CONTENT_REGISTRY_ADDRESS=<deployed-contract>
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080
ENABLE_MODERATION=true
MAX_UPLOAD_SIZE=104857600
```

## API Endpoints

### Content Management

- `POST /upload` - Upload content (multipart/form-data)
- `GET /download/:identifier` - Download content
- `GET /content/:hash` - Get content metadata
- `POST /route` - Get optimal delivery route

### Seeding

- `POST /seeding/start` - Start seeding content
- `POST /seeding/stop` - Stop seeding content  
- `GET /seeding/stats` - Get seeding statistics
- `POST /seeding/claim` - Claim seeding rewards

### Moderation

- `POST /report` - Report content for moderation
- `GET /blocked/:hash` - Check if content is blocked

### Torrent

- `GET /torrent/:infohash/info` - Get torrent info
- `GET /torrent/:infohash/stats` - Get torrent stats
- `GET /torrent/:infohash/swarm` - Get swarm info

## Content Tiers

| Tier | Description | Reward Rate |
|------|-------------|-------------|
| NETWORK_FREE | Protocol assets | 0 |
| COMMUNITY | Subsidized content | 0.0001 ETH/GB |
| STANDARD | Normal paid storage | 0.0005 ETH/GB |
| PRIVATE_ENCRYPTED | Encrypted data | 0.001 ETH/GB |
| PREMIUM_HOT | High-demand content | 0.002 ETH/GB |

## Contract Deployment

```bash
# Deploy ContentRegistry
cd packages/contracts
forge script script/DeployContentRegistry.s.sol --rpc-url $RPC_URL --broadcast
```

## Testing

```bash
bun test
```
