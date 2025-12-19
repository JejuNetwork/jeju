# @jejunetwork/config

Network configuration, secrets management, and key utilities for Jeju.

## Philosophy

**Config-first architecture:**
- Public values → JSON config files
- Secrets → Environment variables or cloud secret managers
- Everything overridable via env vars

## Quick Start

```typescript
import { 
  getConfig, 
  getContract, 
  getServiceUrl,
  getSecret,
  getApiKey 
} from '@jejunetwork/config';

// Full config for current network
const config = getConfig();

// Contract address
const solver = getContract('oif', 'solverRegistry');

// Service URL
const indexer = getServiceUrl('indexer', 'graphql');

// Optional API key
const etherscan = await getApiKey('etherscan');

// Required secret
const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');
```

## Config Files

```
packages/config/
├── chain/{localnet,testnet,mainnet}.json  # Network settings
├── contracts.json                          # Contract addresses
├── services.json                           # Service URLs
├── eil.json                               # Cross-chain config
├── federation.json                        # Federation config
├── tokens.json                            # Token metadata
└── branding.json                          # Network branding
```

## Modules

### Core (`./index.ts`)

Network config, contracts, services:

```typescript
import { 
  getCurrentNetwork,
  getChainConfig,
  getContract,
  getServiceUrl,
  getConstant,
  getRpcUrl,
  getExplorerUrl 
} from '@jejunetwork/config';
```

### Secrets (`./secrets.ts`)

Secret management with AWS/GCP/local fallback:

```typescript
import { 
  getSecret,
  requireSecret,
  storeAWSSecret,
  getActiveProvider 
} from '@jejunetwork/config/secrets';

// Resolution order: env → AWS → GCP → local file
const key = await getSecret('DEPLOYER_PRIVATE_KEY');

// Check which provider is active
const provider = getActiveProvider(); // 'env' | 'aws' | 'gcp' | 'local'
```

### API Keys (`./api-keys.ts`)

Consolidated API key management (all optional):

```typescript
import { 
  getApiKey,
  hasApiKey,
  printApiKeyStatus,
  getBlockExplorerKeys 
} from '@jejunetwork/config/api-keys';

// Get optional API key
const etherscan = await getApiKey('etherscan');

// Check if configured
if (hasApiKey('walletconnect')) {
  // Enable WalletConnect
}

// Print status of all keys
await printApiKeyStatus();
```

### Test Keys (`./test-keys.ts`)

Test key management for local dev and testnet:

```typescript
import { 
  getTestKeys,
  getKeyByRole,
  getDeployerKey,
  ANVIL_KEYS,
  TEST_MNEMONIC 
} from '@jejunetwork/config/test-keys';

// Get all keys for a network
const keys = getTestKeys('localnet');

// Get specific role
const deployer = getKeyByRole('deployer', 'testnet');

// Pre-computed Anvil keys
console.log(ANVIL_KEYS.deployer.address);
```

### Config Updates (`./update.ts`)

Update config after deployments:

```typescript
import { 
  updateContractAddress,
  updateServiceUrl,
  saveDeploymentArtifact,
  applyTerraformOutputsFile 
} from '@jejunetwork/config/update';

// After deploying a contract
updateContractAddress('oif', 'solverRegistry', '0x...', 'testnet');

// After Terraform apply
applyTerraformOutputsFile('./terraform.output.json', 'testnet');
```

## Environment Variables

### Network Selection
```bash
JEJU_NETWORK=testnet  # localnet | testnet | mainnet
```

### Required Secrets
```bash
DEPLOYER_PRIVATE_KEY=0x...  # For deployments
```

### Optional API Keys
```bash
ETHERSCAN_API_KEY=...       # Contract verification
WALLETCONNECT_PROJECT_ID=.. # Wallet connections
OPENROUTER_API_KEY=...      # AI features
```

### Config Overrides
```bash
JEJU_RPC_URL=https://...    # Override RPC
OIF_SOLVER_REGISTRY=0x...   # Override contract
```

## Key Management CLI

```bash
# Generate keys
bun run scripts/keys/manager.ts generate --network testnet

# Fund keys
bun run scripts/keys/manager.ts fund --bridge

# Check balances
bun run scripts/keys/manager.ts balances

# Export
bun run scripts/keys/manager.ts export --format env
```

## Frontend Usage

Config supports VITE_ and NEXT_PUBLIC_ prefixes:

```typescript
// Automatically checks:
// 1. VITE_BAN_MANAGER_ADDRESS
// 2. NEXT_PUBLIC_BAN_MANAGER_ADDRESS
// 3. Config file value
const banManager = getContract('moderation', 'banManager');
```

## Adding New Config

### New Contract Category

1. Add to `contracts.json`:
```json
{
  "testnet": {
    "newCategory": {
      "myContract": "0x..."
    }
  }
}
```

2. Add type to `index.ts`:
```typescript
export type ContractCategoryName = 
  | ... | 'newCategory';
```

### New Service

1. Add to `services.json`:
```json
{
  "testnet": {
    "newService": {
      "api": "https://..."
    }
  }
}
```

2. Update `ServicesConfig` interface in `index.ts`.

## Exports

```typescript
// Main
export * from './index';

// Submodules
export * from './secrets';
export * from './api-keys';
export * from './test-keys';
export * from './update';
export * from './branding';
export * from './network';
export * from './ports';
```
