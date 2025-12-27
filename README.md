# Jeju

OP-Stack L2 on Ethereum with 200ms Flashblocks, ERC-4337 paymasters, and ERC-8004 agent identity.

**Jeju is both a network and a framework.** Use it, or fork it to launch your own appchain.

## Quick Start

```bash
# Prerequisites
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Run
git clone https://github.com/elizaos/jeju.git && cd jeju
bun install
bun run dev
```

## Fork Your Own Network

Every network you launch becomes part of the Jeju ecosystem:

```bash
# Interactive wizard
bun run jeju fork

# Or with options
bun run jeju fork --name "MyNetwork" --chain-id 123456 --yes
```

This generates everything you need: branding config, genesis, operator keys, Kubernetes manifests, and deployment scripts. Edit `branding.json` to customize your network's name, colors, URLs, and more.

**[Full Forking Guide →](apps/documentation/guides/fork-network.md)**

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Localnet | 31337 | http://127.0.0.1:6546 |
| Testnet | 420690 | https://testnet-rpc.jejunetwork.org |
| Mainnet | 420691 | https://rpc.jejunetwork.org |

## Applications

| App | Port | Purpose |
|-----|------|---------|
| Gateway | 4001 | Bridge, paymasters, staking |
| Bazaar | 4006 | DeFi, NFTs, launchpad, JNS |
| Compute | 4007 | AI inference marketplace |
| Storage | 3100 | IPFS storage marketplace |
| Crucible | 4020 | Agent orchestration |
| DWS | 4030 | Decentralized web services |
| Autocrat | 4040 | DAO governance |
| Indexer | 4350 | GraphQL API |

## Key Features

- **200ms blocks** via Flashblocks
- **Pay gas in any token** via ERC-4337 paymasters
- **Cross-chain intents** via ERC-7683 (OIF)
- **Instant bridging** via XLP liquidity (EIL)
- **Agent identity** via ERC-8004

## Configuration

All configuration is centralized in `packages/config`:

```typescript
import { getConfig, getContract, getServiceUrl } from '@jejunetwork/config';

const config = getConfig();              // Full network config
const solver = getContract('oif', 'solverRegistry');  // Contract address
const indexer = getServiceUrl('indexer', 'graphql');  // Service URL
```

**For localnet:** No configuration needed - everything works out of the box.

**For testnet/mainnet:** Set environment variables:

```bash
export JEJU_NETWORK=testnet
export DEPLOYER_PRIVATE_KEY=0x...
```

See [packages/config/README.md](packages/config/README.md) for full documentation on:
- All available secrets and API keys
- Port allocations
- Service URLs
- Contract addresses
- Environment overrides

## Documentation

- [Quick Start](apps/documentation/getting-started/quick-start.md)
- [Configuration](packages/config/README.md)
- [Architecture](apps/documentation/architecture.md)
- [Contract Deployment](apps/documentation/deployment/contracts.md)
- [API Reference](apps/documentation/api-reference/rpc.md)

Run docs locally:

```bash
cd apps/documentation
bun run dev
```

## Commands

```bash
bun run dev              # Start everything
bun run dev -- --minimal # Chain only
bun run test             # Run tests
bun run clean            # Stop and clean
```

## E2E Testing

Every app with a frontend has comprehensive E2E tests with AI visual verification.

### Run E2E Tests

```bash
# Run E2E tests for a specific app
cd apps/dws
SKIP_WEBSERVER=1 ANTHROPIC_API_KEY=... bunx playwright test tests/e2e/

# Run via jeju CLI
bun run jeju test --mode e2e --app dws
```

### E2E Test Features

- **All routes tested** - Every page from App.tsx
- **AI visual verification** - Claude/OpenAI analyzes screenshots
- **Caching** - Same screenshots reuse AI results
- **Fail-fast** - Crashes immediately on errors
- **Screenshots** - Saved to `test-results/screenshots/`

### Required Environment Variables

```bash
# In .env - for AI visual verification
ANTHROPIC_API_KEY=sk-ant-...  # Claude (preferred)
# OR
OPENAI_API_KEY=sk-...         # GPT-4 Vision
```

### Creating E2E Tests for New Apps

1. Copy `packages/tests/e2e/comprehensive-template.ts` to `apps/<app>/tests/e2e/comprehensive.spec.ts`
2. Extract routes from your `App.tsx`
3. Fill in the `APP_ROUTES` array with path, name, expectedContent, description
4. Run tests: `bunx playwright test tests/e2e/`

## Test Account

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Pre-funded with 10,000 ETH on localnet.

## Structure

```
jeju/
├── apps/           # Applications (gateway, bazaar, crucible, dws, etc.)
├── packages/
│   ├── config/     # Centralized config, secrets, ports, contract addresses
│   ├── contracts/  # Solidity smart contracts
│   ├── deployment/ # Terraform, Kubernetes, Kurtosis
│   ├── sdk/        # Client SDK
│   ├── shared/     # Shared TypeScript utilities
│   └── types/      # Shared type definitions
└── scripts/        # Deployment and utility scripts
```

## License

MIT
