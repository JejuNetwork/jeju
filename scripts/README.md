# Scripts

## Development

```bash
bun run dev              # Start everything (chain + apps)
bun run dev -- --minimal # Chain only
bun run test             # Run tests
bun run clean            # Clean artifacts
```

## Localnet

```bash
bun run localnet:start   # Start local chain
bun run localnet:stop    # Stop local chain
bun run localnet:reset   # Reset chain
```

## Contract Deployment

```bash
export DEPLOYER_PRIVATE_KEY=0x...

bun run contracts:deploy:testnet  # Deploy to testnet
bun run contracts:deploy:mainnet  # Deploy to mainnet
bun run contracts:deploy          # Full multi-step deployment
```

## Infrastructure Deployment

```bash
bun run infra:validate   # Validate terraform/helm
bun run deploy:testnet   # Full testnet infra deployment
bun run deploy:mainnet   # Full mainnet infra deployment
```

## Utilities

```bash
bun run ports            # Check ports
bun run cleanup          # Kill orphaned processes
bun run wallet           # Show wallet config
```

## Structure

```
scripts/
├── dev.ts              # Main dev script
├── deploy/             # Contract deployment
├── shared/             # Shared utilities
└── ...                 # Other utilities

packages/deployment/    # Infrastructure
├── scripts/            # Infra automation
├── kubernetes/         # Helm charts
├── terraform/          # AWS
└── kurtosis/           # Local dev
```
