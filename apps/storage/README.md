# IPFS

Decentralized file storage with local Kubo nodes and x402 micropayments.

## Setup

Install Kubo IPFS:

```bash
# macOS
curl -O https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_darwin-amd64.tar.gz
tar -xvzf kubo_v0.24.0_darwin-amd64.tar.gz
cd kubo
sudo bash install.sh

# Initialize
ipfs init

# Copy config
cp apps/ipfs/node/ipfs-config.json ~/.ipfs/config

# Start daemon
ipfs daemon
```

Install API:

```bash
cd apps/ipfs/pinning-api
bun install
```

## Run

```bash
# Start pinning API
bun run dev
```

API runs on http://localhost:3100

## Test

```bash
# Unit tests
bun test

# Check IPFS connectivity
curl http://localhost:4100/api/v0/id

# Check API health
curl http://localhost:3100/health
```
