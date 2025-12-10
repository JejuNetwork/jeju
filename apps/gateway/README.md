# Gateway

Protocol infrastructure portal. Bridge tokens, deploy paymasters, provide liquidity, and run nodes.

## Setup

```bash
cd apps/gateway
bun install
```

## Environment Variables

Create `.env` for local development or configure for production:

### Required
```bash
VITE_RPC_URL=https://rpc.jeju.network
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Contract Addresses
```bash
VITE_IDENTITY_REGISTRY_ADDRESS=0x...
VITE_TOKEN_REGISTRY_ADDRESS=0x...
VITE_PAYMASTER_FACTORY_ADDRESS=0x...
VITE_BAN_MANAGER_ADDRESS=0x...
VITE_JEJU_TOKEN_ADDRESS=0x...
```

### Services
```bash
VITE_INDEXER_URL=https://indexer.jeju.network/graphql
VITE_LEADERBOARD_API_URL=https://leaderboard.jeju.network
VITE_OIF_AGGREGATOR_URL=https://intents.jeju.network/api
VITE_JEJU_IPFS_GATEWAY=https://ipfs.jeju.network
```

### JNS (Jeju Name Service)
```bash
VITE_JNS_REGISTRY=0x...
VITE_JNS_RESOLVER=0x...
VITE_JNS_REGISTRAR=0x...
VITE_JNS_REVERSE_REGISTRAR=0x...
```

### Network
```bash
VITE_NETWORK=mainnet  # localnet, testnet, or mainnet
```

Contract addresses are auto-loaded from localnet deployment when running locally.

## Run

```bash
# Development
bun run dev

# Production build
bun run build
bun run preview
```

Server runs on http://localhost:4001

## Test

```bash
# Unit tests
bun test:unit

# E2E tests
bun run test:e2e
```
