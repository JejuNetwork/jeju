# Bazaar

Unified token launchpad, Uniswap V4 DEX, NFT marketplace, and prediction markets.

## Architecture

- **Frontend**: React SPA built with Bun, served from `dist/static/`
- **API**: Elysia server, deployable as DWS worker from `dist/worker/`
- **Storage**: IPFS for static assets, SQLit for state

## Setup

```bash
cd apps/bazaar
bun install
```

Create `.env`:

```bash
# Required
WALLETCONNECT_PROJECT_ID=your_project_id

# Network (localnet, testnet, mainnet)
NETWORK=localnet

# Override defaults (optional - uses centralized config by default)
CHAIN_ID=31337
RPC_URL=http://localhost:6546
INDEXER_URL=http://localhost:4350/graphql
```

## Development

```bash
# Full development server (frontend + API hot reload)
bun run dev

# API only (for backend development)
bun run dev:api

# With DWS local stack
bun run dev:dws
```

Development server runs on http://localhost:4006

## Production Build

```bash
# Build frontend + API worker
bun run build

# Start production server
bun run start

# Or run API worker directly
bun run start:worker
```

## Deployment

```bash
# Deploy to DWS (localnet)
bun run deploy

# Deploy to testnet
bun run deploy:testnet

# Deploy to mainnet
bun run deploy:mainnet
```

The deploy script:
1. Builds frontend and worker bundles
2. Uploads static assets to IPFS
3. Deploys worker to DWS network
4. Configures CDN for edge caching

## Testing

```bash
# All tests
bun run test

# Unit tests only
bun run test:unit

# E2E tests (Playwright)
bun run test:e2e

# Wallet integration tests (Synpress)
bun run test:wallet
```
