# @jejunetwork/compute

**Decentralized Compute Marketplace**

A decentralized compute marketplace built on ERC-8004 for AI inference and general compute rentals. Similar to vast.ai, but fully permissionless with wallet-based authentication.

## Features

- **🤖 AI Inference** - OpenAI-compatible API for AI model serving
- **🖥️ Compute Rentals** - Rent GPU/CPU resources by the hour (vast.ai-style)
- **🔐 SSH Access** - Secure shell access to rented machines
- **🐳 Docker Support** - Run custom containers with startup scripts
- **📡 Gateway Proxy** - Access resources without P2P connectivity

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

## Smart Contracts

Located in `packages/contracts/src/compute/`:

- **ComputeRegistry** - ERC-8004 extension for compute providers
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
| NVIDIA H100/H200 | GPU TEE | Production |
| Apple MLX | Secure Enclave | Beta |
| Simulated | None | Testing only |

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
PRIVATE_KEY=           # Provider wallet key
REGISTRY_ADDRESS=      # ComputeRegistry contract
RENTAL_ADDRESS=        # ComputeRental contract
RPC_URL=               # Ethereum RPC endpoint
COMPUTE_PORT=4007      # Node API port
SSH_PORT=2222          # SSH server port
DOCKER_ENABLED=true    # Enable container support
MAX_RENTALS=10         # Max concurrent rentals
```

### Compute Gateway
```bash
GATEWAY_PORT=4009      # Gateway HTTP port
SSH_PROXY_PORT=2222    # SSH proxy port
REGISTRY_ADDRESS=      # ComputeRegistry contract
RENTAL_ADDRESS=        # ComputeRental contract
RPC_URL=               # Ethereum RPC endpoint
```

## Related Projects

- [ERC-8004](https://github.com/ethereum/EIPs) - Trustless Agents standard
- [Arweave](https://www.arweave.org/) - Permanent storage
- [DStack](https://github.com/phala-network/dstack) - TEE framework

## License

MIT
