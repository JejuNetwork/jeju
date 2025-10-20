# Jeju Configuration

Centralized configuration for the Jeju network, including chain configs, port allocation, and network settings.

## Files

### Port Configuration
- **`ports.ts`** - Centralized port allocation with environment variable support
  - Core apps: 4000-4999
  - Vendor apps: 5000-5999
  - Infrastructure: 8000-9999
  - Type-safe getters with env var override support

### Chain Configuration
- **`index.ts`** - Chain configuration loader (mainnet, testnet, localnet)
- **`jeju-defaults.ts`** - Default values and constants
- **`chain/`** - Network-specific configs (JSON files)
  - `mainnet.json` - Production network config
  - `testnet.json` - Test network config
  - `localnet.json` - Local development config

### Token Configuration
- **`base-tokens.json`** - Base chain token metadata (used by scripts/shared/token-utils.ts)
- **`jeju-tokens.json`** - Jeju native token configurations
- **`protocol-tokens.json`** - Protocol tokens with paymaster support

### Deployment Configuration (OP Stack)
- **`deploy-configs/`** - Input files for `op-node genesis` command
- **`genesis/`** - Genesis block templates (generated during deployment)
- **`rollup/`** - Rollup configuration templates (generated during deployment)

## Usage

### Port Configuration

```typescript
import { CORE_PORTS, getCoreAppUrl } from './config/ports';

// Get port with environment override
const port = CORE_PORTS.NODE_EXPLORER_API.get();
// Returns: process.env.NODE_EXPLORER_API_PORT || 4002

// Get full URL with environment override
const apiUrl = getCoreAppUrl('NODE_EXPLORER_API');
// Returns: process.env.NODE_EXPLORER_API_URL || http://localhost:{port}
```

### Chain Configuration

```typescript
import { getChainConfig, getRpcUrl } from './config';

// Load chain config (respects JEJU_NETWORK env var)
const config = getChainConfig('mainnet');

// Get RPC URL with env var override
const rpcUrl = getRpcUrl('testnet');
// Returns: process.env.JEJU_RPC_URL || config.rpcUrl
```

### Default Values

```typescript
import { JejuConfig } from './config/jeju-defaults';

// Get default network
const network = JejuConfig.getDefaultNetwork();
// Returns: process.env.JEJU_NETWORK || 'localnet'

// Get chain ID
const chainId = JejuConfig.getChainId();
// Returns appropriate chain ID based on network
```

## Environment Variables

### Port Configuration

All ports can be overridden via environment variables:

```bash
# Core apps (use app-specific prefix)
NODE_EXPLORER_API_PORT=5002
PREDIMARKET_PORT=5005
INDEXER_GRAPHQL_PORT=5350

# Vendor apps (use VENDOR_ prefix)
VENDOR_HYPERSCAPE_CLIENT_PORT=6001
VENDOR_CALIGULAND_GAME_PORT=6008

# Infrastructure
L2_RPC_PORT=9545
PROMETHEUS_PORT=9090
```

### URL Overrides

Full URLs can also be overridden:

```bash
# Override full URL (takes precedence over port)
NODE_EXPLORER_API_URL=https://api.example.com
INDEXER_GRAPHQL_URL=https://indexer.example.com/graphql

# Point to remote services
JEJU_RPC_URL=https://rpc.jeju.network
```

### Chain Configuration

```bash
# Network selection
JEJU_NETWORK=localnet|testnet|mainnet

# RPC overrides
JEJU_RPC_URL=http://localhost:9545
JEJU_WS_URL=ws://localhost:9546
JEJU_EXPLORER_URL=http://localhost:4000

# L1 (Base) configuration
JEJU_L1_RPC_URL=http://localhost:8545
```

## Token Configuration Files

### base-tokens.json
Tokens on Base (L1) that can be bridged to Jeju. Used by deployment scripts for:
- Setting up initial liquidity pools
- Configuring bridge contracts
- Price oracle initialization

### jeju-tokens.json
Native Jeju tokens and bridged token addresses on Jeju (L2). Used by:
- `apps/bazaar` for marketplace token listings
- Frontend applications for token metadata

### protocol-tokens.json
Tokens with deployed paymaster infrastructure. Includes:
- Paymaster contract addresses
- LP reward distribution settings
- Bridge configuration

## Validation

### Check Port Configuration
```bash
bun run ports
```

Shows:
- All allocated ports
- Environment variable overrides (if any)
- Port conflicts (if any)
- Port range validation

### Run Config Tests
```bash
bun test config/index.test.ts
```

Tests:
- Configuration loading
- Environment variable overrides
- Contract address resolution
- URL getters
- Validation

## Design Principles

1. **Environment First** - All values configurable via env vars
2. **Sensible Defaults** - Works out of the box
3. **Type Safety** - TypeScript for correctness
4. **Clear Naming** - Prefixes prevent collisions
5. **Flexible Override** - Support both ports and full URLs
6. **Backward Compatible** - Falls back to generic vars

## Port Ranges Explained

### Why 4000-4999 for Core Apps?
- Avoids common dev ports (3000, 8000, 8080)
- Room for 1000 core services
- Clear separation from vendor apps
- No conflicts with infrastructure

### Why 5000-5999 for Vendor Apps?
- Isolated from core infrastructure
- Vendors can't conflict with critical services
- Easy to identify third-party services
- Clear ownership boundary

### Why 8000-9999 for Infrastructure?
- RPC standard ports (8545, 9545)
- Monitoring tools (9090, 4010)
- System services
- Critical infrastructure separation

## Deployment Template Files

The `deploy-configs/`, `genesis/`, and `rollup/` directories contain **template files** used during OP Stack deployment:

### Workflow
1. **Input:** `deploy-configs/{network}.json` defines deployment parameters
2. **Process:** `scripts/generate-genesis.sh` runs `op-node genesis l2` command
3. **Output:** Generates `genesis.json` and `rollup.json` into `config/generated/{network}/`
4. **Distribution:** Generated configs are distributed to node operators

The files in the repo are reference templates. Actual operational configs are generated during deployment.

## Recent Changes

### Removed Files (2025-10-20)
- **`base-networks.json`** - Removed (data duplicated in `chain/*.json` files)
- **`localnet-config.json`** - Removed (data duplicated in `jeju-defaults.ts` and `chain/localnet.json`)

These files were never imported or used by actual application code, only referenced in documentation.

## See Also

- **`deploy-configs/README.md`** - OP Stack deployment configuration details
- **`genesis/README.md`** - Genesis block configuration reference
- **`rollup/README.md`** - Rollup configuration reference

