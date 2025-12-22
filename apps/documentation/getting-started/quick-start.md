# Quick Start

Run Jeju locally. Takes about 10 minutes.

**Requirements:** 16GB RAM, 20GB disk space, Docker running.

## 1. Install Prerequisites

::: code-group

```bash [macOS]
# Install Docker Desktop
brew install --cask docker
open -a Docker  # Start Docker Desktop, wait for it to fully launch

# Install other tools
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

```bash [Linux (Ubuntu/Debian)]
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker  # Apply group change without logout

# Kurtosis
echo "deb [trusted=yes] https://apt.fury.io/kurtosis-tech/ /" | sudo tee /etc/apt/sources.list.d/kurtosis.list
sudo apt update && sudo apt install -y kurtosis-cli

# Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Foundry
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc && foundryup
```

```bash [Windows (WSL2)]
# First, install WSL2 and Ubuntu from Microsoft Store
# Then open Ubuntu terminal and run Linux commands above

# Or use Docker Desktop for Windows with WSL2 backend
```

:::

## 2. Verify Installation

Run these before continuing:

```bash
docker --version    # Need 24.0+
kurtosis version    # Need v0.90.0+
bun --version       # Need 1.0.0+
forge --version     # Need 0.2.0+
```

If any fail, fix that tool before continuing.

## 3. Start Jeju

```bash
git clone https://github.com/elizaos/jeju.git
cd jeju
bun install
bun run dev
```

First run takes 5-10 minutes to download images. You'll see logs scrolling. Wait until you see:

```
✓ All services started
```

## 4. What's Running

| Service | URL | Purpose |
|---------|-----|---------|
| **L2 RPC** | http://127.0.0.1:9545 | Jeju blockchain |
| **L1 RPC** | http://127.0.0.1:8545 | Local Ethereum |
| **Gateway** | http://127.0.0.1:4001 | Bridge & staking UI |
| **Bazaar** | http://127.0.0.1:4006 | DeFi & NFT UI |
| **Indexer** | http://127.0.0.1:4350/graphql | GraphQL API |

Open http://127.0.0.1:4001 in your browser.

## 5. Test It

```bash
# Check L2 is producing blocks
cast block latest --rpc-url http://127.0.0.1:9545

# Send ETH (uses pre-funded test account)
cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 0.1ether \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## 6. Add to MetaMask

| Setting | Value |
|---------|-------|
| Network Name | Jeju Localnet |
| RPC URL | `http://127.0.0.1:9545` |
| Chain ID | `1337` |
| Currency | ETH |

Import this test account (has 10,000 ETH):

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Commands

```bash
bun run dev        # Start everything
bun run dev:min    # Chain only, no apps
bun run clean      # Stop and remove containers
bun run test       # Run tests
```

## Troubleshooting

**Docker not starting?**
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
docker ps  # Should show running containers
```

**Port 9545 in use?**
```bash
lsof -i :9545
kill -9 <PID>
```

**Out of disk space?**
```bash
docker system prune -af  # Removes all unused images
```

**Kurtosis enclave stuck?**
```bash
kurtosis clean -a
bun run dev
```

**View detailed logs:**
```bash
kurtosis enclave inspect jeju-localnet
kurtosis service logs jeju-localnet el-1-op-reth-op-node
```

## Next Steps

- [Connect to Testnet](/getting-started/networks) — Deploy to real network
- [SDK Quickstart](/packages/sdk) — Start coding
- [Deploy a Contract](/deployment/overview) — Foundry deployment

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Quick Start

Requirements: Docker 24+, 16GB RAM, 20GB disk

Install (macOS):
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup

Start:
git clone https://github.com/elizaos/jeju.git && cd jeju
bun install
bun run dev

Services:
- L2 RPC: http://127.0.0.1:9545
- L1 RPC: http://127.0.0.1:8545
- Gateway: http://127.0.0.1:4001
- Bazaar: http://127.0.0.1:4006
- Indexer: http://127.0.0.1:4350/graphql

Test account (10,000 ETH):
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

MetaMask: Chain ID 1337, RPC http://127.0.0.1:9545

Commands: bun run dev, bun run dev:min, bun run clean, bun run test
```

</details>
