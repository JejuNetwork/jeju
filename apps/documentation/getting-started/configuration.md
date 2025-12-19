# Configuration

Jeju uses **config-first architecture**. Public values live in JSON config files. Environment variables only provide secrets or overrides.

## Quick Start

For local development, no configuration is needed:

```bash
bun run dev  # Uses localnet with test keys
```

For testnet:

```bash
# Generate and fund keys
bun run scripts/keys/manager.ts generate --network testnet
bun run scripts/keys/manager.ts fund --bridge

# Deploy
JEJU_NETWORK=testnet bun run deploy
```

## Config Files

All configuration lives in `packages/config/`:

| File | Purpose |
|------|---------|
| `chain/{network}.json` | Network settings (RPC, chain ID, bridge contracts) |
| `contracts.json` | All contract addresses by network |
| `services.json` | API URLs by network |
| `eil.json` | Cross-chain (EIL) configuration |
| `federation.json` | Federation network configuration |
| `tokens.json` | Token metadata |
| `branding.json` | Network branding (name, colors, URLs) |
| `ports.ts` | Local port allocations |

## Using Config in Code

```typescript
import { 
  getConfig, 
  getContract, 
  getServiceUrl, 
  getConstant,
  getChainConfig 
} from '@jejunetwork/config';

// Full config for current network (uses JEJU_NETWORK env)
const config = getConfig();
console.log(config.chain.chainId);  // 1337, 420690, or 420691
console.log(config.services.rpc.l2);

// Get contract address (supports env override)
const solver = getContract('oif', 'solverRegistry');

// Get service URL
const indexer = getServiceUrl('indexer', 'graphql');

// Get constants (same across all networks)
const entryPoint = getConstant('entryPoint');
```

## Network Selection

Set the network via environment variable:

```bash
JEJU_NETWORK=testnet         # Backend/scripts
NEXT_PUBLIC_NETWORK=testnet  # Next.js frontend
VITE_NETWORK=testnet         # Vite frontend
```

## Secrets Management

Secrets (private keys, API keys) are managed separately from config.

### Resolution Order

1. Environment variables
2. AWS Secrets Manager (if AWS credentials available)
3. GCP Secret Manager (if GCP project configured)
4. Local files (`.secrets/` directory)

### Using Secrets

```typescript
import { getSecret, requireSecret, getApiKey } from '@jejunetwork/config';

// Optional secret
const apiKey = await getSecret('ETHERSCAN_API_KEY');

// Required secret (throws if not found)
const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');

// API keys (all optional, features degrade gracefully)
const etherscan = await getApiKey('etherscan');
```

### Storing Secrets in AWS

When AWS credentials are available, secrets can be stored in AWS Secrets Manager:

```typescript
import { storeAWSSecret } from '@jejunetwork/config';

await storeAWSSecret('DEPLOYER_PRIVATE_KEY', '0x...');
// Stored as: jeju/secrets/deployer-private-key
```

## Key Management

Use the key manager CLI for generating and managing keys:

```bash
# Generate keys for testnet
bun run scripts/keys/manager.ts generate --network testnet

# Include Solana keys
bun run scripts/keys/manager.ts generate --network testnet --solana

# Fund keys from faucets
bun run scripts/keys/manager.ts fund

# Bridge from Sepolia to L2 testnets
bun run scripts/keys/manager.ts fund --bridge

# Check balances
bun run scripts/keys/manager.ts balances

# Export for env file
bun run scripts/keys/manager.ts export --format env

# Export for Safe multi-sig setup
bun run scripts/keys/manager.ts export --format safe
```

### Key Roles

| Role | Description |
|------|-------------|
| `deployer` | Deploys all contracts |
| `sequencer` | Produces L2 blocks |
| `batcher` | Submits transaction batches to L1 |
| `proposer` | Submits L2 output roots to L1 |
| `challenger` | Challenges invalid output roots |
| `admin` | Proxy admin owner |
| `guardian` | Superchain config guardian |
| `xlp` | Cross-chain liquidity provider |
| `multisig1-3` | Multi-sig signers (2/3 threshold) |

### Localnet Keys

Localnet uses the standard Anvil test mnemonic:

```
test test test test test test test test test test test junk
```

Primary test account:
- Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

## Environment Overrides

Override any config value via environment:

```bash
# RPC URLs
JEJU_RPC_URL=https://custom-rpc.example.com

# Contract addresses
OIF_SOLVER_REGISTRY=0x...
REGISTRY_IDENTITY=0x...

# Service URLs
INDEXER_GRAPHQL_URL=https://custom-indexer.example.com
```

## Frontend Configuration

### Vite Apps

```bash
# .env
VITE_NETWORK=mainnet
VITE_RPC_URL=https://rpc.jejunetwork.org
VITE_CHAIN_ID=420691
VITE_WALLETCONNECT_PROJECT_ID=your-project-id
```

### Next.js Apps

```bash
# .env.local
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_RPC_URL=https://rpc.jejunetwork.org
NEXT_PUBLIC_CHAIN_ID=420691
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

## Updating Config After Deployment

Deploy scripts automatically update config files:

```typescript
import { updateContractAddress, updateServiceUrl } from '@jejunetwork/config/update';

// After deploying a contract
updateContractAddress('oif', 'solverRegistry', deployedAddress, 'testnet');

// After deploying infrastructure
updateServiceUrl('indexer', 'graphql', 'https://...', 'testnet');
```

### Terraform Integration

Apply Terraform outputs to config:

```typescript
import { applyTerraformOutputsFile } from '@jejunetwork/config/update';

applyTerraformOutputsFile('./terraform.output.json', 'testnet');
```

## API Keys Reference

All API keys are optional. Features degrade gracefully when keys are missing.

| Key | Purpose | Fallback |
|-----|---------|----------|
| `ETHERSCAN_API_KEY` | Contract verification | Verification skipped |
| `BASESCAN_API_KEY` | Base contract verification | Verification skipped |
| `WALLETCONNECT_PROJECT_ID` | Wallet modal | Injected wallets only |
| `OPENROUTER_API_KEY` | AI features | AI features disabled |
| `PINATA_JWT` | IPFS pinning | Local IPFS node |
| `ALCHEMY_API_KEY` | Enhanced RPC | Public RPCs |
| `NEYNAR_API_KEY` | Farcaster features | Direct Hub access |

Check API key status:

```typescript
import { printApiKeyStatus } from '@jejunetwork/config';

await printApiKeyStatus();
// Shows configured/missing keys and their purposes
```

## File Structure

```
packages/config/
├── chain/
│   ├── localnet.json    # Localnet settings
│   ├── testnet.json     # Testnet settings
│   └── mainnet.json     # Mainnet settings
├── contracts.json       # Contract addresses
├── services.json        # Service URLs
├── eil.json            # Cross-chain config
├── federation.json     # Federation config
├── tokens.json         # Token metadata
├── branding.json       # Network branding
├── index.ts            # Main exports
├── secrets.ts          # Secret management
├── api-keys.ts         # API key management
├── test-keys.ts        # Test key utilities
├── update.ts           # Config update utilities
└── ports.ts            # Port allocations
```
