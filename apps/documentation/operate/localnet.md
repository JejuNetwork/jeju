# Localnet

Run a complete Jeju environment locally.

## Quick Start

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

Wait ~2 minutes for all services to start.

## What Runs

| Service | Port | Auto-start |
|---------|------|------------|
| L2 RPC (op-reth) | 9545 | ✅ |
| L2 WebSocket | 9546 | ✅ |
| L1 RPC (Geth) | 8545 | ✅ |
| L1 Beacon | 4000 | ✅ |
| Gateway | 4001 | ✅ |
| Bazaar | 4006 | ✅ |
| Compute | 4007 | ❌ |
| Storage | 4010 | ❌ |
| Indexer | 4350 | ❌ |

## Commands

```bash
# Full environment
bun run dev

# Chain only (faster)
bun run dev --minimal

# Stop
bun run localnet:stop
# Or Ctrl+C

# Reset to fresh state
bun run localnet:reset

# View logs
kurtosis enclave inspect jeju-localnet
kurtosis service logs jeju-localnet el-1-op-reth-op-node
```

## Pre-deployed Contracts

All core contracts deploy automatically:
- JejuToken, ERC20Factory
- IdentityRegistry, BanManager
- MultiTokenPaymaster, PaymasterFactory
- OIF contracts
- Uniswap V4

## Test Accounts

| # | Address | Balance |
|---|---------|---------|
| 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | 10,000 ETH |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | 10,000 ETH |
| 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | 10,000 ETH |

Primary key:
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

See [Test Accounts](/reference/test-accounts) for full list.

## Deploy Your Contracts

```bash
cd packages/contracts

forge create src/MyContract.sol:MyContract \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Add to Wallet

```
Network Name: Jeju Localnet
RPC URL: http://127.0.0.1:9545
Chain ID: 1337
Currency: ETH
```

## Troubleshooting

**Docker not running?**
```bash
open -a Docker  # macOS
sudo systemctl start docker  # Linux
```

**Port in use?**
```bash
lsof -i :9545
kill -9 <PID>
# Or
bun run cleanup
```

**Enclave fails?**
```bash
kurtosis clean -a
bun run dev
```

**Out of disk?**
```bash
docker system prune -a
kurtosis clean -a
```

