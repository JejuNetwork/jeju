# IPFS

Decentralized storage with x402 micropayments.

**URL**: http://127.0.0.1:3100

## Architecture

```
Kubo IPFS (4100) → Pinning API (3100) → FileStorageManager.sol
```

## Setup

```bash
# Install Kubo
curl -O https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_darwin-amd64.tar.gz
tar -xvzf kubo_*.tar.gz && cd kubo && sudo bash install.sh

# Start
ipfs init && ipfs daemon

# Start API
cd apps/ipfs/pinning-api
bun install && bun run dev
```

## API

```bash
POST /pins        # Pin CID
GET  /pins        # List pins
DELETE /pins/{id} # Unpin
POST /upload      # Upload file
GET  /ipfs/{cid}  # Retrieve
```

## Pricing

- Storage: $0.10/GB/month
- Retrieval: Free
- Tokens: USDC, elizaOS, ETH

## Frontend

http://127.0.0.1:4001/storage (Gateway Portal)
