# Scripts

Utility scripts and deployment orchestration for Jeju Network.

## Structure

```
scripts/
├── shared/          # Utility library (imported, not run directly)
├── deploy/          # Deployment scripts (run via CLI or directly)
├── bootstrap-localnet-complete.ts  # Used by CLI for localnet setup
├── clean.ts         # Build cleanup
└── setup-apps.ts    # Postinstall app setup
```

## Usage

Most operations should use the Jeju CLI:

```bash
# Development
jeju dev              # Start localnet + apps
jeju dev --minimal    # Localnet only
jeju dev --stop       # Stop everything

# Testing
jeju test             # Run all tests
jeju test --phase=contracts
jeju test --app=bazaar

# Deployment
jeju deploy testnet --token
jeju deploy mainnet --token --safe 0x...
jeju deploy verify testnet
jeju deploy check testnet

# Status
jeju status           # Check running services
jeju status --check   # Full diagnostics

# Keys
jeju keys             # Show dev keys
jeju keys genesis     # Generate production keys
```

## Deploy Scripts

For specific deployment needs, scripts in `deploy/` can be run directly:

```bash
bun run scripts/deploy/token.ts --network testnet
bun run scripts/deploy/oif.ts localnet
bun run scripts/deploy/testnet.ts
```

## Shared Utilities

The `shared/` directory contains importable utilities:

- `chains.ts` - Chain configuration
- `rpc.ts` - RPC helpers
- `logger.ts` - Logging
- `paymaster.ts` - Paymaster integration
- `eil.ts` - EIL (Ethereum Intent Layer)
- `discover-apps.ts` - App discovery
