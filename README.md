# Jeju

An Ethereum-based network for humans and agents.


## Install

```bash
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

```bash
git clone https://github.com/elizaos/jeju.git && cd jeju
bun install
```

## Development

```bash
bun run dev              # Start localnet + apps
bun run dev -- --minimal # Localnet only
bun run test             # Run tests
bun run clean            # Stop and clean
```

Or use the CLI directly:

```bash
jeju dev                 # Start everything
jeju test                # Run tests
jeju status              # Check what's running
jeju keys                # Show keys
jeju fund 0x...          # Fund address
```

### Test Account

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key:     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Pre-funded with 10,000 ETH on localnet.

## Deployment

### Testnet

```bash
export JEJU_NETWORK=testnet
export DEPLOYER_PRIVATE_KEY=0x...
jeju deploy testnet
```

### Mainnet

```bash
export JEJU_NETWORK=mainnet
export DEPLOYER_PRIVATE_KEY=0x...
export SEQUENCER_PRIVATE_KEY=0x...
export BATCHER_PRIVATE_KEY=0x...
jeju deploy mainnet
```

### Deploy Contracts

```bash
jeju deploy token        # Token contracts
jeju deploy oif          # OIF contracts
jeju deploy jns          # JNS contracts
jeju deploy x402         # Payment protocol
jeju deploy chainlink    # Chainlink integration
```

### Deploy Apps

```bash
jeju publish             # Deploy current project
jeju preview             # Create preview deployment
jeju worker deploy       # Deploy worker to DWS
```

## Structure

```
jeju/
├── apps/           # Applications
├── packages/
│   ├── config/     # Configuration
│   ├── contracts/  # Solidity contracts
│   ├── deployment/ # Terraform, Kubernetes
│   ├── sdk/        # Client SDK
│   └── cli/        # CLI tool
└── scripts/        # Utility scripts
```

## Networks

| Network  | Chain ID | RPC                              |
|----------|----------|----------------------------------|
| Localnet | 31337    | http://127.0.0.1:6546            |
| Testnet  | 420690   | https://testnet-rpc.jejunetwork.org |
| Mainnet  | 420691   | https://rpc.jejunetwork.org      |
