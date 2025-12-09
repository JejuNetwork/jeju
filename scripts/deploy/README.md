# Contract Deployment

Scripts for deploying smart contracts to Jeju networks.

## Quick Start

```bash
export DEPLOYER_PRIVATE_KEY=0x...

# Deploy to testnet
bun run contracts:deploy:testnet

# Deploy to mainnet  
bun run contracts:deploy:mainnet

# Full deployment (L1 + L2 + DeFi + AA + verification)
bun run contracts:deploy -- --network testnet
```

## Scripts

| Script | Description |
|--------|-------------|
| `testnet.ts` | Deploy core contracts to testnet |
| `mainnet.ts` | Deploy core contracts to mainnet |
| `l1-contracts.ts` | Deploy L1 contracts only |
| `eil.ts` | Deploy EIL (cross-chain) contracts |
| `defi-protocols.ts` | Deploy DeFi protocols |
| `account-abstraction.ts` | Deploy AA infrastructure |

## Config

Networks defined in `packages/config/chain/*.json`.

Required environment variables:
```bash
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...  # Optional, for verification
```

## Addresses

Saved to `packages/contracts/deployments/<network>/deployment.json`.

```typescript
import { getContractAddress } from '@jejunetwork/config';
const registry = getContractAddress('identityRegistry');
```

## Notes

- Get testnet ETH: https://www.alchemy.com/faucets/base-sepolia
- For infrastructure deployment, see `packages/deployment/`
