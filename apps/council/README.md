# Jeju AI Council

AI-powered DAO governance with council deliberation, CEO decisions, and on-chain proposal submission.

## Quick Start

```bash
./scripts/start-council-dev.sh        # Anvil + Contracts + API
./scripts/start-council-dev.sh --ui   # With frontend
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Council API (port 8010)                  │
├─────────────────┬─────────────────┬─────────────────────────┤
│ ProposalAssist  │  ResearchAgent  │     CouncilAgents       │
│ - Quality Score │  - Deep Analysis│     - Treasury          │
│ - Attestation   │  - Compute Mkt  │     - Code              │
│                 │  - Ollama       │     - Community         │
│                 │                 │     - Security          │
├─────────────────┴─────────────────┴─────────────────────────┤
│                    TEE Service (CEO Decisions)               │
│                - Hardware TEE (Phala Cloud)                  │
│                - Simulated TEE (local dev)                   │
│                - Lit Protocol (encryption)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Smart Contracts (Anvil/Base)              │
│  Council.sol  │  CEOAgent.sol  │  QualityOracle.sol         │
└─────────────────────────────────────────────────────────────┘
```

## Required Dependencies

- **Bun** - Runtime and package manager
- **Foundry** - Smart contract development (anvil, forge)
- **Ollama** - Local LLM inference (for AI features)

## Optional Dependencies

### TEE (Trusted Execution Environment)

For production CEO decision-making with hardware attestation:

```bash
# Set environment variables for Phala Cloud TEE
export TEE_API_KEY=your-phala-api-key
export TEE_CLOUD_URL=https://cloud.phala.network/api/v1

# Require hardware TEE (will fail if not configured)
export REQUIRE_HARDWARE_TEE=true
```

**Without TEE_API_KEY**: Uses simulated TEE with local AES-256-GCM encryption. This is fine for development but provides no hardware attestation guarantees.

### Lit Protocol

For distributed key management and conditional decryption:

```bash
# Install optional dependency
bun add @lit-protocol/lit-node-client

# Configure network
export LIT_NETWORK=cayenne  # or 'habanero' for mainnet
```

**Without Lit Protocol**: Falls back to local AES-256-GCM encryption. Decryption is immediate (no access control conditions enforced).

### Compute Marketplace

For decentralized LLM inference with x402 payments:

```bash
# Enable compute marketplace for deep research
export COMPUTE_ENABLED=true
export COMPUTE_URL=http://localhost:8020  # or production endpoint
export COMPUTE_MODEL=claude-3-opus
```

**Without Compute**: Uses local Ollama for all inference. Deep research falls back to standard depth.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | Yes | `http://localhost:9545` | Blockchain RPC endpoint |
| `COUNCIL_ADDRESS` | Yes | - | Deployed Council contract |
| `CEO_AGENT_ADDRESS` | Yes | - | Deployed CEOAgent contract |
| `QUALITY_ORACLE_ADDRESS` | Yes | - | Deployed QualityOracle contract |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | No | `llama3.2:3b` | Ollama model to use |
| `OPERATOR_KEY` | No | - | Private key for research operator |
| `ASSESSOR_KEY` | No | - | Private key for quality assessor |
| `TEE_API_KEY` | No | - | Phala Cloud API key |
| `COMPUTE_ENABLED` | No | `false` | Enable compute marketplace |
| `COMPUTE_URL` | No | `http://localhost:8020` | Compute marketplace URL |

## Security

The council package has no known vulnerabilities. Monorepo-level audit shows 7 vulnerabilities in other workspaces (`eliza-otc-desk`, `eliza-cloud-v2`, `@safe-global`) that do not affect this package.

```bash
bun audit  # Check vulnerabilities
```

## Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test tests/synpress/             # API tests
bun test tests/integration/          # Integration tests

# Run contract tests
cd ../../packages/contracts && forge test --match-contract "Council|QualityOracle"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/v1/proposals/assess` | POST | Assess proposal quality |
| `/api/v1/governance/stats` | GET | Get governance statistics |
| `/api/v1/ceo` | GET | Get CEO status |
| `/mcp/tools/list` | POST | List MCP tools |
| `/mcp/tools/call` | POST | Call MCP tool |
| `/a2a` | POST | Agent-to-agent messaging |

## Deployment

### Localnet (Development)

```bash
./scripts/start-council-dev.sh
```

### Testnet (Base Sepolia)

```bash
export DEPLOYER_KEY=0x...
./scripts/deploy-testnet.sh
```

### Docker

```bash
docker-compose up
```
