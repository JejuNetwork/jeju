# Config

Jeju network configuration. Config-first architecture - no `.env` needed for public values.

## Usage

```typescript
import { getConfig, getContract, getServiceUrl, getConstant } from '@jejunetwork/config';

// Full config for current network
const config = getConfig();

// Contract address (env override: OIF_SOLVER_REGISTRY)
const solver = getContract('oif', 'solverRegistry');

// Service URL (env override: INDEXER_GRAPHQL_URL)  
const indexer = getServiceUrl('indexer', 'graphql');

// Constants (EntryPoint, L2 bridge contracts)
const entryPoint = getConstant('entryPoint');
```

## Files

```
packages/config/
├── chain/              # Network settings
│   ├── localnet.json
│   ├── testnet.json
│   └── mainnet.json
├── contracts.json      # All contract addresses (Jeju + external chains)
├── services.json       # API URLs per network
├── tokens.json         # Token metadata
├── chains.json         # Node infrastructure (deployment)
└── ports.ts            # Local port allocations
```

## Environment Overrides

Override any config value:

```bash
JEJU_NETWORK=testnet            # localnet | testnet | mainnet
JEJU_RPC_URL=https://...        # Override RPC
OIF_SOLVER_REGISTRY=0x...       # Override contract
GATEWAY_API_URL=https://...     # Override service URL
```

## Secrets

Only secrets go in `.env`:

```bash
PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```
