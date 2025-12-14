# @jejunetwork/cli

Development toolchain for Jeju Network.

## Installation

```bash
# Global install
bun install -g @jejunetwork/cli

# Or use directly
bunx @jejunetwork/cli
npx @jejunetwork/cli
```

## Commands

```bash
jeju dev              # Start development environment
jeju test             # Run test suite
jeju deploy testnet   # Deploy to testnet
jeju deploy mainnet   # Deploy to mainnet
jeju init my-agent    # Create new project
jeju keys             # Key management
jeju status           # Check system status
```

That's it. **6 commands**.

## Development

```bash
# Start full environment (chain + contracts + apps)
jeju dev

# Localnet only (no apps)
jeju dev --minimal

# Start specific apps
jeju dev --only=gateway,bazaar

# Stop
jeju dev --stop
# Or just Ctrl+C
```

## Testing

```bash
# Run all tests
jeju test

# Specific phase
jeju test --phase=contracts
jeju test --phase=e2e
jeju test --phase=wallet

# CI mode
jeju test --ci
```

## Keys & Genesis Ceremony

```bash
# Show keys
jeju keys

# Check balances
jeju keys balance

# Genesis ceremony for production (secure key generation)
jeju keys genesis -n testnet
jeju keys genesis -n mainnet
```

The genesis ceremony:
1. Security checklist (offline machine, secure storage)
2. Password encryption (16+ chars, mixed case, numbers)
3. Entropy collection (random typing)
4. Key generation + display
5. Encrypted storage

## Deployment

```bash
# Deploy to testnet
jeju deploy testnet

# Deploy to mainnet
jeju deploy mainnet

# Deploy only contracts
jeju deploy testnet --contracts

# Dry run
jeju deploy testnet --dry-run
```

## Project Initialization

```bash
# Interactive
jeju init my-app

# With type
jeju init my-agent --type=agent
jeju init my-dapp --type=dapp
jeju init my-service --type=service
```

## Status & Diagnostics

```bash
# Quick status
jeju status

# Full system check
jeju status --check
```

## Integration with Monorepo

The root `package.json` includes:

```bash
bun run jeju:dev      # Same as: jeju dev
bun run jeju:test     # Same as: jeju test
bun run jeju:deploy   # Same as: jeju deploy
```

## License

MIT
