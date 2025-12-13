# Quick Start

Run Jeju locally in under 10 minutes.

## Prerequisites

### macOS

```bash
# Docker
brew install --cask docker

# Kurtosis (local chain orchestration)
brew install kurtosis-tech/tap/kurtosis

# Bun (JavaScript runtime)
curl -fsSL https://bun.sh/install | bash

# Foundry (Solidity toolchain)
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Linux

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Kurtosis
echo "deb [trusted=yes] https://apt.fury.io/kurtosis-tech/ /" | sudo tee /etc/apt/sources.list.d/kurtosis.list
sudo apt update && sudo apt install kurtosis-cli

# Bun
curl -fsSL https://bun.sh/install | bash

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Verify Installation

```bash
docker --version    # 24.0+
kurtosis version    # v0.90.0+
bun --version       # 1.0.0+
forge --version     # 0.2.0+
```

## Start Localnet

```bash
# Clone and install
git clone https://github.com/elizaos/jeju.git
cd jeju
bun install

# Start everything
bun run dev
```

This starts:
- **L1** (Ethereum): Geth + Lighthouse at port 8545
- **L2** (Jeju): op-reth + op-node at port 9545
- **Indexer**: GraphQL API at port 4350
- **Gateway**: Web UI at port 4001
- **Contracts**: Deployed to localnet

Press `Ctrl+C` to stop all services.

## Verify It Works

```bash
# Check L2 is producing blocks
cast block latest --rpc-url http://127.0.0.1:9545

# Send a test transaction
cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 0.1ether \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Check balance
cast balance 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url http://127.0.0.1:9545
```

## Access Applications

**Gateway** at http://127.0.0.1:4001 provides bridging, staking, and paymaster interfaces. **Bazaar** at http://127.0.0.1:4006 offers DeFi, NFTs, and launchpad functionality. **Indexer** at http://127.0.0.1:4350/graphql exposes the GraphQL playground. **Compute** at http://127.0.0.1:4007 runs the AI inference marketplace. **Storage** at http://127.0.0.1:4010 handles IPFS storage operations.

## Minimal Mode

Start only the chain without applications:

```bash
bun run dev -- --minimal
```

## Common Commands

```bash
# Development
bun run dev              # Start all services
bun run dev -- --minimal # Chain only
bun run test             # Run test suite
bun run clean            # Stop and clean up

# Localnet management
bun run localnet:start   # Start chain
bun run localnet:stop    # Stop chain
bun run localnet:reset   # Reset to fresh state

# Contract development
cd packages/contracts
forge build              # Compile contracts
forge test               # Run Solidity tests
```

## Add to Wallet

Configure MetaMask or any EVM wallet with Network Name "Jeju Localnet", RPC URL http://127.0.0.1:9545, Chain ID 1337, and Currency Symbol ETH.

Import test account:
```
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Troubleshooting

**Docker not running**
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

**Port already in use**
```bash
# Find process
lsof -i :9545

# Kill it
kill -9 <PID>

# Or use cleanup script
bun run cleanup
```

**Kurtosis enclave fails**
```bash
# Clean all enclaves
kurtosis clean -a

# Retry
bun run dev
```

**View logs**
```bash
# List services
kurtosis enclave inspect jeju-localnet

# View specific service logs
kurtosis service logs jeju-localnet el-1-op-reth-op-node
```

## Next Steps

- [Network Configuration](/getting-started/networks) - Testnet and mainnet setup
- [Deploy Contracts](/deployment/contracts) - Deploy your own contracts
- [Run an RPC Node](/guides/run-rpc-node) - Operate infrastructure
