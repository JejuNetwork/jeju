# @jejunetwork/token

Cross-chain token deployment and Hyperlane Warp Routes for EVM chains.

## Bridge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               JEJU CROSS-CHAIN TOKEN BRIDGING               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  EVM ←──────────────→ EVM          This package (Hyperlane) │
│       Fast (3-5 min)                                         │
│       Validator security                                     │
│                                                              │
│  EVM ←──────────────→ Solana       @jejunetwork/zksolbridge (ZK)   │
│       Trustless (10-15 min)                                  │
│       Cryptographic proofs                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Features

| Feature | Description |
|---------|-------------|
| **JEJU Token** | Native token of Jeju Network, home chain on Jeju L2 |
| **Hyperlane Warp Routes** | Fast token bridging across EVM chains |
| **DAO-Governed Fees** | Configurable fees via Council/CEOAgent governance |
| **Custom Tokens** | Deploy your own cross-chain tokens |

## Quick Start

```bash
# Build
bun run build

# Run tests
bun test

# Deploy JEJU to testnet
jeju token deploy:jeju --network testnet

# Deploy JEJU to localnet
jeju token deploy:jeju --network localnet

# Dry run (no transactions)
jeju token deploy:jeju --network testnet --dry-run

# Deploy full token ecosystem
jeju token deploy:ecosystem --network testnet

# Deploy Hyperlane infrastructure
jeju token deploy:hyperlane --network testnet

# Deploy to Solana
jeju token deploy:solana --network devnet

# Verify deployment
jeju token verify --network testnet
```

## Token Architecture

### JEJU Token

- **Max Supply**: 10 billion
- **Initial Supply**: 1 billion
- **Home Chain**: Jeju Network (L2)
- **Cross-Chain**: Synthetic copies on Ethereum, Base, Arbitrum, Optimism, Solana
- **Faucet**: 100 JEJU per drip (testnet only)

## Supported Chains

### Mainnet

| Chain | Type | Hyperlane Domain |
|-------|------|------------------|
| Ethereum | Home (for custom tokens) | 1 |
| Base | Synthetic | 8453 |
| Arbitrum | Synthetic | 42161 |
| Optimism | Synthetic | 10 |
| Polygon | Synthetic | 137 |
| BSC | Synthetic | 56 |
| Avalanche | Synthetic | 43114 |
| Solana | Synthetic | 1399811149 |

### Testnet

| Chain | Type | Hyperlane Domain |
|-------|------|------------------|
| Sepolia | Home (for custom tokens) | 11155111 |
| Jeju Testnet | Home (for JEJU) | 420690 |
| Base Sepolia | Synthetic | 84532 |
| Arbitrum Sepolia | Synthetic | 421614 |
| Solana Devnet | Synthetic | 1399811150 |

## Usage

### Deploy JEJU Token

```typescript
import {
  JEJU_TESTNET_CONFIG,
  JEJU_TOKEN_METADATA,
  getJEJUDeploymentConfig,
} from '@jejunetwork/token';

const config = getJEJUDeploymentConfig('testnet');
console.log('Home chain:', config.homeChain.name);
console.log('Synthetic chains:', config.syntheticChains.map(c => c.name));
```

### Use Hyperlane Adapter

```typescript
import { HyperlaneAdapter, MAINNET_CHAINS } from '@jejunetwork/token';

const adapter = new HyperlaneAdapter(MAINNET_CHAINS, {});

// Generate warp route config
const warpConfig = adapter.generateWarpRouteConfig(
  tokenAddress,
  [1, 8453, 42161], // chains
  1, // home chain
  ownerAddress,
  validators,
  2 // threshold
);
```

### Use Solana Adapter

```typescript
import { SolanaAdapter } from '@jejunetwork/token';

const adapter = new SolanaAdapter('https://api.devnet.solana.com', false);

// Quote a transfer
const quote = await adapter.quoteTransfer(8453, 1000000n);
console.log('Total fee:', quote.totalFee, 'lamports');
console.log('Estimated time:', quote.estimatedTime, 'seconds');
```

## Fee Configuration

Bridge fees are DAO-governed via FeeConfig:

| Fee Type | Default | Description |
|----------|---------|-------------|
| XLP Reward | 80% | Share of bridge fees to LPs |
| Protocol | 10% | Share to protocol treasury |
| Burn | 10% | Deflationary burn |
| Bridge Min | 0.05% | Minimum bridge fee |
| Bridge Max | 1% | Maximum bridge fee |
| ZK Discount | 20% | Discount for ZK-verified transfers |

## File Structure

```
packages/token/
├── src/
│   ├── bridge/
│   │   ├── hyperlane-adapter.ts  # EVM cross-chain
│   │   └── solana-adapter.ts     # Solana integration
│   ├── config/
│   │   ├── chains.ts             # Chain configurations
│   │   ├── domains.ts            # Hyperlane domain IDs
│   │   ├── jeju-deployment.ts    # JEJU token config
│   │   └── tokenomics.ts         # Token economics utilities
│   ├── deployer/
│   │   ├── contract-deployer.ts
│   │   └── solana-deployer.ts
│   ├── integration/
│   │   ├── jeju-registry.ts
│   │   └── solana-infra.ts
│   └── types.ts
├── scripts/
│   └── deploy-jeju.ts            # JEJU deployment script
└── tests/
    ├── hyperlane-adapter.test.ts
    ├── solana-adapter.test.ts
    ├── chains.test.ts
    └── domains.test.ts
```

## Custom Token Deployment

To deploy your own cross-chain token:

```bash
# Using CLI (recommended)
jeju token deploy:jeju --network testnet
# Then modify token config in packages/token/src/config/

# Or deploy full ecosystem
jeju token deploy:ecosystem --network testnet
```

## Related Packages

- `@jejunetwork/zksolbridge` - Trustless ZK bridge for Solana↔EVM (use this for Solana)
- `packages/contracts/src/tokens/` - Token smart contracts
- `packages/contracts/src/hyperlane/` - Hyperlane infrastructure contracts
- `apps/bazaar/` - Token trading UI

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/tests/hyperlane-adapter.test.ts

# Run with coverage
bun test --coverage
```
