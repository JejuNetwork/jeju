<div align="center">
  <img src="apps/documentation/JejuLogo.jpg" alt="Jeju Network" width="400"/>
  
  # Jeju Network
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-black)](https://bun.sh)
  [![Powered by OP Stack](https://img.shields.io/badge/Powered%20by-OP%20Stack-red)](https://optimism.io)
</div>

---

## 🌴 Welcome to Jeju

Jeju is a high-performance Layer 2 blockchain built for the next generation of onchain applications. We're bringing together AI agents, 3D multiplayer games, DeFi protocols, and instant payment systems—all in one unified ecosystem.

## 🪙 Multi-Token Support

**Bring Your Token. Power the Chain.**

Jeju supports multiple tokens for gas payments and protocol interactions:

### How It Works

1. **Bridge from Base** - Use the Gateway Portal to bridge your tokens
2. **Deploy Paymaster** - Each token has its own paymaster system
3. **Provide ETH Liquidity** - Earn fees in the token users spend
4. **Use Your Tokens** - Pay for gas, bet on markets, play games

```bash
# Bridge CLANKER from Base to Jeju
bun run scripts/bridge-multi-tokens.ts CLANKER 1000

# Deploy paymaster for a new token
bun run scripts/deploy-per-token-paymaster.ts <TOKEN_ADDRESS>

# Initialize pools
bun run scripts/init-multi-token-pools.ts
```

### For Token Holders

If you hold CLANKER, VIRTUAL, or CLANKERMON on Base:

1. **Bridge** to Jeju (2 minutes, Standard Bridge)
2. **Use everywhere** - Pay gas, place bets, use services
3. **Earn rewards** - Provide liquidity, earn protocol fees

### For Liquidity Providers

Provide ETH, earn fees in ANY protocol token:

- **CLANKER LPs**: Earn CLANKER when users pay gas with CLANKER
- **VIRTUAL LPs**: Earn VIRTUAL when users pay gas with VIRTUAL
- **Multi-token LPs**: Provide ETH to all vaults, earn all tokens

See [BRIDGING_GUIDE.md](./docs/BRIDGING_GUIDE.md) and [LP_REWARDS_GUIDE.md](./docs/LP_REWARDS_GUIDE.md).

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+ (our preferred runtime)
- [Docker](https://docker.com) (for infrastructure services)
- [Foundry](https://getfoundry.sh) (for smart contracts)

### Quick Start

**Launch the entire Jeju ecosystem in one command:**

```bash
bun run dev
```

This starts:
- ✅ Kurtosis Localnet (L1 + L2 blockchain)
- ✅ Subsquid Indexer + GraphQL API
- ✅ Node Explorer (network monitoring)
- ✅ Vendor Apps (dynamically discovered from `/vendor`)
- ✅ Monitoring: Prometheus + Grafana
- ✅ Documentation site

### 📦 Vendor Apps (Optional)

Third-party applications are in `/vendor` as git submodules. They're **completely optional** and **dynamically discovered**.

```bash
# List available vendor apps
bun run vendor:list

# Migrate existing apps to vendor
bun run vendor:migrate

# Start only vendor apps
bun run dev:vendor
```

See [VENDOR_MIGRATION_GUIDE.md](./VENDOR_MIGRATION_GUIDE.md) for details.

### 🦊 Wallet Setup (MetaMask)

After starting the dev environment, you'll see a **WALLET SETUP** section at the bottom with the exact RPC URL.

**Quick Setup:**

1. Open MetaMask
2. Click **Networks** → **Add Network** → **Add a network manually**
3. Enter these **STATIC** values (never change):
   - **Network Name:** `Jeju Localnet`
   - **RPC URL:** `http://127.0.0.1:9545` ← **L2 - STATIC PORT**
   - **Chain ID:** `1337`
   - **Currency Symbol:** `ETH`
4. Click **Save**

**✅ DONE!** This network configuration is permanent. The dev environment automatically forwards port 9545 to Kurtosis's dynamic L2 port, so you **never** need to change your MetaMask config!

**🔍 Need to see it again?** Run this anytime:
```bash
bun run wallet
```

**💰 Import Test Account:**

Use this pre-funded account to interact with contracts:
- **Private Key:** `0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291`
- **Address:** `0x71562b71999873DB5b286dF957af199Ec94617F7`
- **Balance:** Unlimited ETH

In MetaMask: **Import Account** → Paste the private key above.

### Quick Test

Verify everything is working:

```bash
# Check network connectivity
bun run scripts/test-jeju-detection.ts

# Verify ERC-8004 agent registry
bun scripts/verify-erc8004.ts

# Run smoke tests
bun run scripts/smoke-runtime.ts
```

---

## 🔨 Building

### Install Dependencies

```bash
bun install
bun run build
```

### Build Smart Contracts

```bash
cd contracts
forge build
```

### Deploy Contracts Locally

```bash
# Bootstrap complete localnet with all contracts
bun run scripts/bootstrap-localnet-complete.ts

# Or deploy specific systems
bun run scripts/deploy-uniswap-v4.ts
bun run scripts/deploy-paymaster-system.ts
```

---

## 🧪 Testing

### Run Contract Tests

```bash
cd contracts
forge test
```

### Run Integration Tests

```bash
# Full test suite
bun run scripts/test-all.sh

# Specific test suites
cd packages/plugin-x402 && bun test
cd contracts && forge test --match-contract "*USDC*|*Credit*|*Paymaster*"
```

### Runtime E2E Tests

```bash
# Start services
bun run dev

# In another terminal, run E2E tests
bun run scripts/smoke-runtime.ts
```

---

## 🚢 Deployment

### Deploy to Testnet

```bash
# Set environment variables
export JEJU_NETWORK=testnet
export DEPLOYER_PRIVATE_KEY=0x...
export JEJU_RPC_URL=https://testnet-rpc.jeju.network

# Deploy contracts
cd contracts
forge script script/Deploy.s.sol --broadcast --verify
```

### Deploy to Mainnet

```bash
# Set environment variables
export JEJU_NETWORK=mainnet
export DEPLOYER_PRIVATE_KEY=0x...
export JEJU_RPC_URL=https://rpc.jeju.network

# Deploy with verification
cd contracts
forge script script/Deploy.s.sol --broadcast --verify --slow
```

## 📖 Network Information

### Quick Reference: Jeju Localnet

**🦊 MetaMask Configuration (Copy These Values):**

```
Network Name:   Jeju Localnet
RPC URL:        http://127.0.0.1:9545  ← L2 - STATIC PORT
Chain ID:       1337
Currency:       ETH
```

**💰 Test Account (Import to MetaMask):**
```
Private Key: 0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291
Address:     0x71562b71999873DB5b286dF957af199Ec94617F7
```

### All Networks

| Network | Chain ID | RPC URL | Notes |
|---------|----------|---------|-------|
| **Mainnet** | 420691 | https://rpc.jeju.network | Production |
| **Testnet** | 420690 | https://testnet-rpc.jeju.network | Public testnet |
| **Localnet (L2)** | 1337 | **http://127.0.0.1:9545** | **STATIC - Never changes!** |
| **Localnet (L1)** | 1337 | http://127.0.0.1:8545 | For L1 contracts only |

### Port Architecture

**STATIC PORTS (configured by `bun run dev`):**

- **L2 RPC:** `9545` ← **Use this for wallets & apps**
- **L1 RPC:** `8545` (L1 only)
- Port forwarding: `socat` automatically forwards to Kurtosis dynamic ports
- **Result:** Set up your wallet once, works forever!

**Core App Ports (4000-4999):**
- Paymaster Dashboard: `4001`
- Node Explorer API: `4002`
- Node Explorer UI: `4003`
- Documentation: `4004`
- Indexer GraphQL: `4350`

**Vendor App Ports (4005+, 5000-5999):**
- Predimarket: `4005`
- Hyperscape: `5001` (API: `5002`)
- Launchpad: `5003`
- TheDesk: `5004` (API: `5005`)
- Cloud: `5006`
- Caliguland: `5007` (Game: `5008`, Auth: `5009`)
- redteam: `5010`

### Key Contracts (Localnet)

| Contract | Address |
|----------|---------|
| PoolManager (Uniswap V4) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| elizaOS Token | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| WETH (L2 Bridge) | `0x4200000000000000000000000000000000000006` |