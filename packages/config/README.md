# @jejunetwork/config

Centralized configuration, secrets management, and key utilities for Jeju Network.

## Philosophy

**Config-first architecture:**
- **Public values** → JSON config files (services.json, contracts.json, etc.)
- **Secrets** → Environment variables or cloud secret managers
- **Everything overridable** via environment variables
- **Localnet works out of the box** - no configuration needed

## Quick Start

```typescript
import { 
  getConfig, 
  getContract, 
  getServiceUrl,
  getSecret,
  getApiKey,
  requireSecret
} from '@jejunetwork/config';

// Full config for current network
const config = getConfig();

// Contract address (checks env overrides, then config)
const solver = getContract('oif', 'solverRegistry');

// Service URL
const indexer = getServiceUrl('indexer', 'graphql');

// Optional API key (returns undefined if not set)
const etherscan = await getApiKey('etherscan');

// Required secret (throws if not found)
const deployerKey = await requireSecret('DEPLOYER_PRIVATE_KEY');
```

## Configuration by Environment

### Localnet (Default)

**No configuration needed!** Localnet uses:
- Anvil test accounts for all operations
- Default localhost URLs (see `services.json`)
- Pre-deployed contracts from local deployment

```bash
# Just run - no env vars needed
bun run dev
```

### Testnet

Set the network and deployer key:

```bash
# Required
export JEJU_NETWORK=testnet
export DEPLOYER_PRIVATE_KEY=0x...

# Optional - for contract verification
export ETHERSCAN_API_KEY=...
export BASESCAN_API_KEY=...
```

### Mainnet

Set the network and all required operator keys:

```bash
export JEJU_NETWORK=mainnet
export DEPLOYER_PRIVATE_KEY=0x...
export SEQUENCER_PRIVATE_KEY=0x...
export BATCHER_PRIVATE_KEY=0x...
# ... other operator keys as needed
```

## Config Files

```
packages/config/
├── chain/
│   ├── localnet.json          # Local chain settings
│   ├── testnet.json           # Testnet chain settings
│   └── mainnet.json           # Mainnet chain settings
├── chainlink/                 # Chainlink integration configs
│   ├── feeds.json             # Price feed addresses
│   ├── vrf.json               # VRF configuration
│   ├── automation.json        # Automation config
│   └── index.ts               # Chainlink utilities
├── contracts.json             # All contract addresses
├── services.json              # All service URLs
├── eil.json                   # Cross-chain liquidity config
├── federation.json            # Federation config
├── tokens.json                # Token metadata
├── branding.json              # Network branding
├── infrastructure.json        # Node infrastructure config
├── ports.ts                   # Port allocations
├── secrets.ts                 # Secret type definitions
├── api-keys.ts                # Optional API key registry
└── env.example.txt            # Example environment file
```

## Secrets Reference

### Deployment Keys (Required for deployments)

| Secret | Description | Required For |
|--------|-------------|--------------|
| `DEPLOYER_PRIVATE_KEY` | Primary deployer key | All deployments |
| `PRIVATE_KEY` | Generic private key alias | Scripts |
| `OPERATOR_PRIVATE_KEY` | Operator operations | Service operations |

### Operator Keys (Required for running infrastructure)

| Secret | Description | Required For |
|--------|-------------|--------------|
| `SEQUENCER_PRIVATE_KEY` | Sequencer operations | L2 block production |
| `BATCHER_PRIVATE_KEY` | Batch submission | L1 batch posting |
| `PROPOSER_PRIVATE_KEY` | State proposals | L1 state roots |
| `CHALLENGER_PRIVATE_KEY` | Fraud proofs | Dispute resolution |
| `ORACLE_PRIVATE_KEY` | Price feed updates | Oracle service |
| `FACILITATOR_PRIVATE_KEY` | Payment facilitation | x402 service |
| `FAUCET_PRIVATE_KEY` | Testnet faucet | Faucet service |
| `SOLVER_PRIVATE_KEY` | Intent solving | OIF solver |

### Cross-Chain Keys

| Secret | Description | Required For |
|--------|-------------|--------------|
| `XLP_PRIVATE_KEY` | Cross-chain liquidity | EIL operations |
| `SOLANA_PRIVATE_KEY` | Solana operations | Solana bridge |
| `EVM_PRIVATE_KEY` | Generic EVM key | Multi-chain ops |

### Platform Tokens (For multi-platform bots)

| Secret | Description | Required For |
|--------|-------------|--------------|
| `DISCORD_BOT_TOKEN` | Discord bot auth | Discord bots |
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth | Telegram bots |
| `TWITTER_API_KEY` | Twitter API access | Twitter bots |
| `TWITTER_API_SECRET` | Twitter API secret | Twitter bots |
| `TWITTER_ACCESS_TOKEN` | Twitter OAuth | Twitter bots |
| `TWITTER_ACCESS_SECRET` | Twitter OAuth secret | Twitter bots |
| `TWITTER_BEARER_TOKEN` | Twitter bearer | Twitter bots |
| `FARCASTER_SIGNER_UUID` | Farcaster signer | Farcaster bots |

### Communication Services

| Secret | Description | Required For |
|--------|-------------|--------------|
| `TWILIO_ACCOUNT_SID` | Twilio account | Phone auth |
| `TWILIO_AUTH_TOKEN` | Twilio auth | Phone auth |
| `TWILIO_PHONE_NUMBER` | Twilio number | SMS sending |
| `SMTP_USER` | Email username | Email auth |
| `SMTP_PASSWORD` | Email password | Email auth |

### Cloud Providers

| Secret | Description | Required For |
|--------|-------------|--------------|
| `AWS_ACCESS_KEY_ID` | AWS access key | AWS services |
| `AWS_SECRET_ACCESS_KEY` | AWS secret | AWS services |
| `AWS_REGION` | AWS region | AWS services |
| `GCP_PROJECT_ID` | GCP project | GCP services |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API | DNS management |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 | Object storage |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret | Object storage |

### Database Credentials

| Secret | Description | Required For |
|--------|-------------|--------------|
| `DB_USER` | Database username | PostgreSQL |
| `DB_PASSWORD` | Database password | PostgreSQL |
| `REDIS_PASSWORD` | Redis password | Redis |
| `EQLITE_PRIVATE_KEY` | EQLite key | Decentralized DB |

### Encryption Secrets

| Secret | Description | Required For |
|--------|-------------|--------------|
| `VAULT_ENCRYPTION_SECRET` | Vault encryption | Key storage |
| `TEE_ENCRYPTION_SECRET` | TEE encryption | TEE operations |
| `MPC_ENCRYPTION_SECRET` | MPC encryption | MPC signing |
| `KMS_FALLBACK_SECRET` | KMS fallback | Local KMS |
| `REDIS_ENCRYPTION_KEY` | Redis encryption | Encrypted cache |

## Optional API Keys

All API keys are optional - features degrade gracefully when not configured.

### Block Explorer Verification

```bash
ETHERSCAN_API_KEY=...        # Ethereum contract verification
BASESCAN_API_KEY=...         # Base contract verification
ARBISCAN_API_KEY=...         # Arbitrum contract verification
OPSCAN_API_KEY=...           # Optimism contract verification
```

### Frontend Integration

```bash
WALLETCONNECT_PROJECT_ID=... # Wallet connections in frontends
```

### Storage

```bash
PINATA_JWT=...               # IPFS pinning (falls back to local node)
```

### Social

```bash
NEYNAR_API_KEY=...           # Farcaster API (falls back to hub)
GITHUB_TOKEN=...             # GitHub API access
```

### AI/ML Providers

```bash
OPENROUTER_API_KEY=...       # OpenRouter (recommended)
OPENAI_API_KEY=...           # Direct OpenAI access
ANTHROPIC_API_KEY=...        # Direct Claude access
GROQ_API_KEY=...             # Groq inference
HF_TOKEN=...                 # Hugging Face
```

### Enhanced RPC

```bash
ALCHEMY_API_KEY=...          # Enhanced RPC endpoints
HELIUS_API_KEY=...           # Solana enhanced RPC
```

### Infrastructure

```bash
SUCCINCT_API_KEY=...         # Remote ZK proving
PHALA_API_KEY=...            # TEE infrastructure
ONEINCH_API_KEY=...          # DEX aggregation
```

## Port Allocations

Default ports for local development (all overridable via env):

### Core Apps (4000-4099)

| Service | Port | Env Override |
|---------|------|--------------|
| Gateway | 4013 | `GATEWAY_PORT` |
| Node Explorer API | 4002 | `NODE_EXPLORER_API_PORT` |
| Documentation | 4004 | `DOCUMENTATION_PORT` |
| Bazaar | 4006 | `BAZAAR_PORT` |
| Factory | 4009 | `FACTORY_PORT` |
| Crucible | 4020 | `CRUCIBLE_PORT` |
| DWS | 4030 | `DWS_PORT` |
| Autocrat | 4040 | `AUTOCRAT_PORT` |
| KMS | 4050 | `KMS_PORT` |
| OAuth3 | 4060 | `OAUTH3_PORT` |
| Oracle | 4070 | `ORACLE_PORT` |
| Node | 4080 | `NODE_PORT` |
| Leaderboard | 4090 | `LEADERBOARD_PORT` |

### Infrastructure

| Service | Port | Env Override |
|---------|------|--------------|
| L1 RPC | 6545 | `L1_RPC_PORT` |
| L2 RPC | 6546 | `L2_RPC_PORT` |
| L2 WebSocket | 6547 | `L2_WS_PORT` |
| Indexer GraphQL | 4350 | `INDEXER_GRAPHQL_PORT` |
| Prometheus | 9090 | `PROMETHEUS_PORT` |
| Grafana | 4010 | `GRAFANA_PORT` |

## Service URLs

All service URLs are configured in `services.json` and can be overridden:

```bash
# RPC URLs
JEJU_RPC_URL=https://...     # L2 RPC
JEJU_L1_RPC_URL=https://...  # L1 RPC
JEJU_WS_URL=wss://...        # WebSocket

# Service URLs
INDEXER_URL=https://...      # Indexer GraphQL
GATEWAY_URL=https://...      # Gateway UI
AUTOCRAT_URL=https://...     # Autocrat API
DWS_URL=https://...          # DWS API
```

## Contract Address Overrides

Contract addresses support multiple override formats:

```bash
# VITE_ prefix (for Vite apps)
VITE_BAN_MANAGER_ADDRESS=0x...

# PUBLIC_ prefix (for Next.js apps)
PUBLIC_BAN_MANAGER_ADDRESS=0x...

# Category prefix (for scripts)
MODERATION_BAN_MANAGER=0x...
```

## Secret Resolution Order

Secrets are resolved in this order:
1. Environment variables (fastest, for CI/CD)
2. AWS Secrets Manager (if `AWS_REGION` set)
3. GCP Secret Manager (if `GCP_PROJECT_ID` set)
4. Local file fallback (`.secrets/` directory)

```typescript
// Note: secrets module is internal - import directly if needed in Node.js
import { getSecret, getActiveProvider } from '../secrets';

// Check which provider is being used
const provider = getActiveProvider(); // 'env' | 'aws' | 'gcp' | 'local'

// Get a secret (checks all providers)
const key = await getSecret('DEPLOYER_PRIVATE_KEY');

// Require a secret (throws if not found)
const required = await requireSecret('DEPLOYER_PRIVATE_KEY');
```

## Modules

### Core (`./index.ts`)

```typescript
import { 
  getCurrentNetwork,    // Get current network from JEJU_NETWORK
  getChainConfig,       // Chain settings (chainId, RPC, etc.)
  getContract,          // Contract address with env override
  getServiceUrl,        // Service URL with env override
  getConstant,          // Constant addresses (EntryPoint, etc.)
  getRpcUrl,            // L2 RPC URL
  getL1RpcUrl,          // L1 RPC URL
  getExplorerUrl,       // Block explorer URL
  getFrontendContracts, // All frontend contract addresses
  getFrontendServices,  // All frontend service URLs
} from '@jejunetwork/config';
```

### Secrets (`./secrets.ts`)

```typescript
import { 
  getSecret,            // Get optional secret
  requireSecret,        // Get required secret (throws if missing)
  requireSecretSync,    // Sync version (env/local only)
  getActiveProvider,    // Check which secret provider is active
  validateSecrets,      // Validate multiple secrets exist
  storeLocalSecret,     // Store secret locally
  storeAWSSecret,       // Store secret in AWS
} from '../secrets'; // Internal module, import directly if needed
```

### API Keys (`./api-keys.ts`)

```typescript
import { 
  getApiKey,            // Get optional API key
  hasApiKey,            // Check if API key is configured
  getApiKeyStatus,      // Get status of all API keys
  printApiKeyStatus,    // Print status to console
  getBlockExplorerKeys, // Get all block explorer keys
  getAIProviderKeys,    // Get all AI provider keys
  hasAnyAIProvider,     // Check if any AI provider is configured
} from '@jejunetwork/config'; // Re-exported from barrel
```

### Ports (`./ports.ts`)

```typescript
import { 
  CORE_PORTS,           // Core app port configs
  VENDOR_PORTS,         // Vendor app port configs
  INFRA_PORTS,          // Infrastructure port configs
  getCoreAppUrl,        // Build URL for core app
  getL2RpcUrl,          // Get L2 RPC URL
  checkPortConflicts,   // Check for port conflicts
  printPortAllocation,  // Print all port allocations
} from '@jejunetwork/config';
```

### Test Keys (`./test-keys.ts`)

```typescript
import { 
  getTestKeys,          // Get all test keys for network
  getKeyByRole,         // Get key by role
  getDeployerKey,       // Get deployer key
  ANVIL_KEYS,           // Pre-computed Anvil keys
  TEST_MNEMONIC,        // Standard test mnemonic
} from '../test-keys'; // Internal module, import directly if needed
```

### Config Updates (`./update.ts`)

```typescript
import { 
  updateContractAddress,    // Update contract in contracts.json
  updateServiceUrl,         // Update service in services.json
  saveDeploymentArtifact,   // Save deployment artifact
  applyTerraformOutputs,    // Apply Terraform outputs to config
} from '../update'; // Internal module, import directly if needed
```

## Environment File Template

Copy `env.example.txt` to `.env` in your project root:

```bash
cp packages/config/env.example.txt .env
```

Then fill in only the secrets you need for your environment.

## Adding New Configuration

### New Contract Category

1. Add to `contracts.json`:
```json
{
  "localnet": {
    "newCategory": {
      "myContract": "0x..."
    }
  }
}
```

2. Add type to `schemas.ts`:
```typescript
export type ContractCategory = 
  | ... | 'newCategory';
```

### New Service

1. Add to `services.json`:
```json
{
  "localnet": {
    "newService": {
      "api": "http://127.0.0.1:4100"
    }
  }
}
```

2. Update `ServicesNetworkConfigSchema` in `schemas.ts`.

### New Secret

Add to `SecretName` type in `secrets.ts`:
```typescript
export type SecretName =
  | ... | 'NEW_SECRET_NAME';
```

### New Port

Add to `CORE_PORTS` or `VENDOR_PORTS` in `ports.ts`:
```typescript
NEW_SERVICE: {
  DEFAULT: 4100,
  ENV_VAR: 'NEW_SERVICE_PORT',
  get: () => safeParsePort(process.env.NEW_SERVICE_PORT, 4100),
},
```
