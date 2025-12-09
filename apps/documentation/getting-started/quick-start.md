# Quick Start

Run Jeju locally in 10 minutes.

## Prerequisites

```bash
# macOS
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash

# Verify
docker --version    # 24.0+
kurtosis version    # v0.90.0+
bun --version       # 1.0.0+
```

## Start

```bash
git clone https://github.com/elizaos/jeju.git
cd jeju
bun install
bun run dev
```

This starts:
- L1 Ethereum (Geth + Lighthouse)
- L2 Jeju (op-reth + op-node + batcher + proposer)
- Indexer + GraphQL API
- Pre-funded test accounts

Press `Ctrl+C` to stop.

## Verify

```bash
cast block latest --rpc-url http://127.0.0.1:9545

cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 0.1ether \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Network Config

| Parameter | Value |
|-----------|-------|
| Chain ID | 1337 |
| RPC | http://127.0.0.1:9545 |
| WebSocket | ws://127.0.0.1:9546 |
| L1 RPC | http://127.0.0.1:8545 |

## Test Accounts

Standard Foundry accounts, pre-funded with 10,000 ETH:

```
Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Commands

```bash
bun run dev                    # Full environment
bun run dev -- --minimal       # Just localnet
bun run test                   # Run tests

kurtosis enclave inspect jeju-localnet  # View services
kurtosis service logs jeju-localnet el-1-op-reth-op-node  # View logs
```

## Troubleshooting

**Docker not running**: Start Docker Desktop or `sudo systemctl start docker`

**Port in use**: `lsof -i :9545` then `kill -9 <PID>`

**Enclave fails**: `kurtosis clean -a` then retry

## Next Steps

- [Deploy Contracts](/developers/deploy-contracts)
- [Local Development](/developers/local-development)
- [Connect to Testnet](/network/testnet)
