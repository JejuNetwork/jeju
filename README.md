# Jeju

OP-Stack L2 on Ethereum with 200ms Flashblocks, ERC-4337 paymasters, and ERC-8004 agent identity.

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

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Localnet | 1337 | http://127.0.0.1:9545 |
| Testnet | 420690 | https://testnet-rpc.jeju.network |
| Mainnet | 420691 | https://rpc.jeju.network |

## Applications

| App | Port | Purpose |
|-----|------|---------|
| Gateway | 4001 | Bridge, paymasters, staking |
| Bazaar | 4006 | DeFi, NFTs, launchpad, JNS |
| Compute | 4007 | AI inference marketplace |
| Storage | 4010 | IPFS storage marketplace |
| Crucible | 4020 | Agent orchestration |
| Indexer | 4350 | GraphQL API |

## Key Features

- **200ms blocks** via Flashblocks
- **Pay gas in any token** via ERC-4337 paymasters
- **Cross-chain intents** via ERC-7683 (OIF)
- **Instant bridging** via XLP liquidity (EIL)
- **Agent identity** via ERC-8004

## Documentation

- [Quick Start](apps/documentation/getting-started/quick-start.md)
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

## Test Account

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Pre-funded with 10,000 ETH on localnet.

## Structure

```
jeju/
├── apps/           # Applications (gateway, bazaar, compute, etc.)
├── packages/
│   ├── config/     # Network config, contract addresses
│   ├── contracts/  # Solidity smart contracts
│   ├── deployment/ # Terraform, Kubernetes, Kurtosis
│   ├── shared/     # Shared TypeScript utilities
│   └── types/      # Shared type definitions
└── scripts/        # Deployment and utility scripts
```

## License

MIT
