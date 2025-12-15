# @jejunetwork/compute

**Decentralized Compute Marketplace**

A decentralized compute marketplace built on ERC-8004 for AI inference and general compute rentals. Similar to vast.ai, but fully permissionless with wallet-based authentication.

## Features

- **🤖 AI Inference** - OpenAI-compatible API for AI model serving
- **🖥️ Compute Rentals** - Rent GPU/CPU resources by the hour (vast.ai-style)
- **⚡ Serverless Workers** - Deploy JavaScript/TypeScript workers (Cloudflare Workers-style)
- **🔐 SSH Access** - Secure shell access to rented machines
- **🐳 Docker Support** - Run custom containers with startup scripts
- **📡 Gateway Proxy** - Access resources without P2P connectivity
- **🔒 TEE Execution** - Run on Phala, Marlin, Oasis, or any registered TEE provider

## Goals

1. **100% Permissionless** - No API keys, no logins, only wallet signatures
2. **Decentralized Registry** - Providers register via ERC-8004 on-chain
3. **Hardware Attestation** - Cryptographic proof of GPU/TEE capabilities
4. **Stake-based Security** - Users and providers stake for accountability
5. **Open Gateway** - Any gateway can route to any provider

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER CLIENT                              │
│           (Wallet auth + SSH keys for compute access)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    HTTP API     │  │   SSH ACCESS    │  │  DOCKER API     │
│  (inference)    │  │ (shell access)  │  │  (containers)   │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      COMPUTE GATEWAY                             │
│  Provider Discovery │ HTTP Proxy │ SSH Proxy │ Session Mgmt     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   COMPUTE NODE  │  │   COMPUTE NODE  │  │   COMPUTE NODE  │
│   (GPU Server)  │  │   (TEE Node)    │  │   (CPU Server)  │
│                 │  │                 │  │                 │
│ • Inference API │  │ • Inference API │  │ • Container Mgmt│
│ • SSH Server    │  │ • SSH Server    │  │ • SSH Server    │
│ • Docker Mgmt   │  │ • Docker Mgmt   │  │ • Resource Mon  │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BLOCKCHAIN LAYER                           │
│                                                                  │
│   IdentityRegistry   │ ComputeRegistry │ ComputeRental           │
│   (ERC-8004 agents)  │ (providers)     │ (sessions/escrow)       │
│                      │                 │                         │
│   LedgerManager      │ InferenceServing│ ComputeStaking          │
│   (user balances)    │ (settlements)   │ (provider stakes)       │
│                                                                  │
│   Chains: Anvil (local) → Sepolia → Ethereum Mainnet             │
└─────────────────────────────────────────────────────────────────┘
```

## Serverless Workers

Deploy JavaScript/TypeScript workers that run on any TEE provider:

```bash
# Start the worker runtime server
bun run src/compute/workers/server.ts

# Deploy a worker
curl -X POST http://localhost:4020/api/v1/workers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "code": "export default { fetch(request) { return new Response(\"Hello from Jeju!\"); } }",
    "routes": ["/hello/*"]
  }'

# Invoke via route
curl http://localhost:4020/w/hello/test
```

### Worker Features
- **JavaScript/TypeScript** - Full ES2022+ support
- **Fetch API** - Standard `fetch()` for HTTP requests
- **Crypto API** - Web Crypto for cryptographic operations  
- **Route Patterns** - Wildcard routing (`/api/*`, `/users/:id`)
- **Cron Triggers** - Scheduled execution via cron expressions
- **TEE Attestation** - Verifiable execution on trusted hardware

## Smart Contracts

Located in `packages/contracts/src/compute/`:

- **ComputeRegistry** - ERC-8004 extension for compute providers
- **WorkerRegistry** - Serverless worker deployments and versioning
- **TriggerRegistry** - Cron/webhook/event triggers
- **JobRegistry** - Training job queue with TEE workers
- **ComputeRental** - Session management, escrow, SSH key storage
- **LedgerManager** - User ledger and payment management
- **InferenceServing** - Payment settlement for inference jobs
- **ComputeStaking** - User and provider stake management

## Compute Node

Providers run nodes that:
- Detect and attest hardware (GPU/TEE)
- Serve OpenAI-compatible inference
- Manage Docker containers for rentals
- Provide SSH access to rented machines
- Generate cryptographic attestations
- Register on-chain via ERC-8004

## Compute Gateway

The gateway provides non-P2P access:
- HTTP proxy to compute node APIs
- SSH proxy for shell access
- Session authentication via signatures
- Provider discovery and routing

## Quick Start

### 1. Run a Local Node (Easiest)

```bash
# Instant start with test key (recommended for development)
bun run dev:test

# Or provide your own key
PRIVATE_KEY=your-key bun run node

# Or use an env file
cp env.example .env
# Edit .env with your private key
bun run node
```

The node starts immediately at `http://localhost:4007` with:
- OpenAI-compatible API at `/v1/chat/completions`
- Hardware detection at `/v1/hardware`
- Health check at `/health`

### 2. Test the Node

```bash
# Health check
curl http://localhost:4007/health

# Chat completion
curl http://localhost:4007/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-model","messages":[{"role":"user","content":"Hello!"}]}'

# Run validation suite
bun run validate
```

### 3. Connect to Real Model (Ollama)

```bash
# Start Ollama
ollama serve &
ollama pull llama2

# Start node with Ollama backend
PRIVATE_KEY=your-key MODEL_NAME=llama2 MODEL_BACKEND=ollama bun run node
```

### Prerequisites

- Bun 1.0+
- A wallet private key (generate with `cast wallet new`)
- Docker (optional, for container support)

### Run Tests

```bash
bun run test
```

### Deploy Contracts

```bash
# First, build contracts
cd packages/contracts && forge build

# Deploy to Jeju Testnet (L2 on Sepolia)
NETWORK=testnet bun run deploy:testnet

# Deploy to Jeju Mainnet (L2 on Ethereum)
NETWORK=mainnet bun run deploy:mainnet
```

## Security Model

### Staking Requirements

| Role | Minimum Stake | Purpose |
|------|---------------|---------|
| User | 0.01 ETH | Prevent spam/abuse |
| Provider | 0.1 ETH | Accountable for service quality |
| Guardian | 1.0 ETH | Moderation privileges |

### Trust Models

1. **Reputation** - ERC-8004 feedback from users
2. **Attestation** - Hardware verification (TEE/GPU)
3. **Staking** - Economic security via slashing

## Supported Hardware

| Platform | TEE Type | Status |
|----------|----------|--------|
| Intel TDX | Hardware | Production |
| Intel SGX | Hardware | Production |
| AMD SEV | Hardware | Production |
| AWS Nitro | Hardware | Production |
| NVIDIA H100/H200 | GPU TEE | Production |
| Apple MLX | Secure Enclave | Beta |
| Simulated | None | Testing only |

## TEE Provider Networks

Providers register permissionlessly via `ComputeRegistry`. Jeju seeds the network with nodes on:

### Phala Network
- **TEE Type**: Intel SGX/TDX via dStack
- **Capabilities**: Inference, Workers, Secrets management
- **Attestation**: DCAP verification

### Marlin Protocol  
- **TEE Type**: Intel TDX via Oyster
- **Capabilities**: Workers, ZK proving (Kalypso)
- **Attestation**: On-chain via Marlin contracts

### Oasis Network
- **TEE Type**: Intel SGX via Sapphire ParaTime
- **Capabilities**: Confidential compute, Workers
- **Attestation**: ROFL (Runtime Off-chain Logic)

## Provider Funding Requirements

To operate TEE nodes, providers need native tokens on each network:

### Testnet

| Provider | Token | Amount | Purpose |
|----------|-------|--------|---------|
| Phala | PHA | 100 PHA | Compute credits |
| Marlin | POND | 1,000 POND | Operator stake |
| Oasis | TEST ROSE | 100 ROSE | Deployment gas |
| Jeju | ETH | 0.1 ETH | Provider stake |

### Mainnet

| Provider | Token | Amount | Purpose |
|----------|-------|--------|---------|
| Phala | PHA | 10,000 PHA | Compute credits + staking |
| Marlin | POND + MPond | 100,000 POND | Operator stake + delegation |
| Oasis | ROSE | 10,000 ROSE | Deployment + gas reserve |
| Jeju | ETH | 1.0 ETH | Provider stake |

### Seeding Providers

```bash
# Seed testnet providers (dry run)
bun scripts/seed-providers.ts --network testnet --dry-run

# Seed specific provider
bun scripts/seed-providers.ts --network testnet --provider phala

# Seed all providers
PROVIDER_PRIVATE_KEY=0x... bun scripts/seed-providers.ts --network testnet
```

## Project Structure

```
apps/compute/
├── src/
│   ├── compute/         # Core compute marketplace
│   │   ├── node/        # Compute node (inference, SSH, Docker)
│   │   ├── sdk/         # Client SDK (inference & rental)
│   │   ├── scripts/     # Deployment scripts
│   │   └── tests/       # Test suites
│   ├── gateway/         # Compute gateway (HTTP & SSH proxy)
│   ├── storage/         # Arweave storage
│   ├── tee/             # TEE abstractions
│   └── infra/           # Blockchain clients
└── deployments/         # Deployment artifacts
```

## Environment Variables

### Compute Node
```bash
PRIVATE_KEY=           # Provider wallet key (required)
REGISTRY_ADDRESS=      # ComputeRegistry contract
RENTAL_ADDRESS=        # ComputeRental contract
RPC_URL=               # Ethereum RPC endpoint
COMPUTE_PORT=4007      # Node API port
SSH_PORT=2222          # SSH server port
DOCKER_ENABLED=true    # Enable container support
MAX_RENTALS=10         # Max concurrent rentals
```

### MPC Node (Threshold Signing)
```bash
MPC_NODE_ID=           # Unique node identifier (auto-generated if not set)
MPC_PORT=4010          # MPC server port (default: 4010)
MPC_NETWORK_ID=        # Network ID: jeju-localnet | jeju-testnet | jeju-mainnet
MPC_THRESHOLD=1        # Signing threshold (default: 1)
MPC_TOTAL_SHARES=1     # Total key shares (default: 1)
MPC_PEERS=             # Comma-separated peer list: nodeId@endpoint,...
MPC_VERBOSE=false      # Enable verbose logging
```

### Compute Gateway
```bash
GATEWAY_PORT=4009      # Gateway HTTP port
SSH_PROXY_PORT=2222    # SSH proxy port
REGISTRY_ADDRESS=      # ComputeRegistry contract
RENTAL_ADDRESS=        # ComputeRental contract
RPC_URL=               # Ethereum RPC endpoint
```

### Worker Runtime
```bash
WORKER_SERVER_PORT=4020         # Worker API port
WORKER_REGISTRY_ADDRESS=        # WorkerRegistry contract
RPC_URL=                        # Ethereum RPC endpoint
WORKER_DEFAULT_TIMEOUT_MS=30000 # Default execution timeout
WORKER_DEFAULT_MEMORY_MB=128    # Default memory limit
```

### Provider Seeding
```bash
PROVIDER_PRIVATE_KEY=           # Wallet for registering providers
TESTNET_COMPUTE_REGISTRY_ADDRESS=  # Testnet registry
MAINNET_COMPUTE_REGISTRY_ADDRESS=  # Mainnet registry
TESTNET_WORKER_REGISTRY_ADDRESS=   # Testnet worker registry
MAINNET_WORKER_REGISTRY_ADDRESS=   # Mainnet worker registry
```

## MPC Node

The MPC (Multi-Party Computation) node provides threshold key management and signing for decentralized authentication. It auto-detects local TEE hardware capability.

### Quick Start

```bash
# Start local MPC node (auto-detects TEE capability)
bun run mpc:dev

# Start with custom config
MPC_NODE_ID=node-1 bun run mpc
```

### TEE Detection

The node automatically detects available TEE hardware:

| Platform | TEE Type | Detection |
|----------|----------|-----------|
| Intel TDX | Hardware TEE | `/dev/tdx_guest` |
| AMD SEV | Hardware TEE | `/dev/sev-guest` |
| NVIDIA H100 | GPU TEE | `nvidia-smi` |
| Simulated | Software | Fallback for dev |

For devnet, real TEE is optional - the node runs in simulated mode if no TEE hardware is detected.

### MPC Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node health + TEE attestation |
| `/mpc/keygen` | POST | Generate threshold key for user |
| `/mpc/sign` | POST | Sign message with threshold key |
| `/mpc/status` | GET | Node status and metrics |

## Related Projects

- [ERC-8004](https://github.com/ethereum/EIPs) - Trustless Agents standard
- [Arweave](https://www.arweave.org/) - Permanent storage

## License

MIT
