# Applications

## Core Apps

| App | Port | Purpose |
|-----|------|---------|
| [Gateway](/applications/gateway) | 4001 | Bridge, Staking, Token Registry |
| [Bazaar](/applications/bazaar) | 4006 | DeFi, NFTs, Prediction Markets |
| [Indexer](/applications/indexer) | 4350 | GraphQL blockchain data |

## Infrastructure

| Service | Port | Purpose |
|---------|------|---------|
| [Monitoring](/applications/monitoring) | 4010 | Prometheus + Grafana |
| [IPFS](/applications/ipfs) | 3100 | Decentralized storage |
| Documentation | 4004 | This site |

## Start All

```bash
bun run dev
```

## Access

| App | URL |
|-----|-----|
| Gateway | http://127.0.0.1:4001 |
| Bazaar | http://127.0.0.1:4006 |
| Indexer | http://127.0.0.1:4350/graphql |
| Monitoring | http://127.0.0.1:4010 |
| Docs | http://127.0.0.1:4004 |

## User Journeys

### Stake & Earn

1. Go to Gateway → Stake
2. Deposit ETH and/or tokens
3. Earn fees from gas payments + bridging

### Bridge Tokens

1. Go to Gateway → Bridge
2. Select source/destination chain
3. Enter amount
4. Confirm

### Register Token for Gas

1. Go to Gateway → Tokens → Register
2. Enter token details
3. Pay 0.1 ETH fee
4. Token usable for gas payments

### Register Agent

1. Go to Gateway → Apps
2. Connect wallet
3. Enter app details
4. Register as ERC-8004 agent
