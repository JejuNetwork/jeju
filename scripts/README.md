# Scripts

Utility scripts and deployment orchestration for Jeju Network.

## Structure

```
scripts/
├── shared/                    # Utility library (imported, not run directly)
├── deploy/                    # Deployment scripts (run via CLI)
├── auto-update/               # Auto-update service (run via CLI)
├── bridge/                    # Bridge monitor service (run via CLI)
├── dispute/                   # Dispute challenger service (run via CLI)
├── oracle/                    # Oracle deployment (run via CLI)
├── sequencer/                 # Sequencer services (run via CLI)
├── vendor/                    # Vendor manifest tools (run via CLI)
├── bootstrap-localnet-complete.ts  # Used by CLI for localnet setup
├── build.ts                   # Build all components
├── clean.ts                   # Build cleanup
├── cleanup-processes.ts       # Cleanup orphaned processes
├── setup-apps.ts              # Postinstall app setup
├── check-testnet-readiness.ts # Testnet readiness (used by CLI)
├── verify-oif-deployment.ts   # OIF verification (used by CLI)
├── fund-testnet-deployer.ts   # Fund testnet deployer
├── setup-testnet-deployer.ts  # Setup testnet deployer keys
├── dev-with-vendor.ts         # Start vendor apps only
└── publish-packages.ts       # Publish packages to npm
```

## Usage

**All operations should use the Jeju CLI** - scripts are now managed through CLI commands:

```bash
# Development
jeju dev              # Start localnet + apps
jeju dev --minimal    # Localnet only
jeju dev --vendor-only  # Start only vendor apps (chain must be running)
jeju dev --stop       # Stop everything

# Testing
jeju test             # Run all tests
jeju test --phase=contracts
jeju test --app=bazaar

# Deployment
jeju deploy testnet --token
jeju deploy mainnet --token --safe 0x...
jeju deploy check testnet      # Comprehensive readiness check
jeju deploy verify oif testnet # Verify OIF deployments
jeju deploy status testnet     # Check deployment status

# Component Deployments (via CLI)
jeju deploy token --network testnet
jeju deploy oif --network testnet
jeju deploy jns --network testnet
jeju deploy oracle --network testnet
jeju deploy dao --network testnet
jeju deploy dao-full --network testnet  # Full DAO stack
jeju deploy governance --network testnet
jeju deploy eil --network testnet
jeju deploy account-abstraction --network testnet
jeju deploy testnet-full  # Full testnet deployment (infrastructure + contracts)
jeju deploy app <name> --network testnet  # Deploy an app
jeju deploy frontend <name> --network testnet  # Deploy frontend to IPFS+JNS
jeju deploy rollback --network testnet --backup latest  # Rollback deployment

# Services (Long-running processes)
jeju service auto-update --network testnet
jeju service bridge --network testnet
jeju service dispute --network testnet
jeju service sequencer --network testnet
jeju service list              # List running services
jeju service stop <name>       # Stop a service
jeju service stop-all          # Stop all services

# Status
jeju status           # Check running services
jeju status --check   # Full diagnostics

# Keys & Wallet
jeju keys             # Show dev keys + MetaMask config
jeju keys genesis     # Generate production keys

# Apps & Ports
jeju apps             # List all apps (core + vendor)
jeju ports            # Check port configuration

# Init & Templates
jeju init <name>      # Create new dApp from template
jeju init vendor <name>  # Create vendor app manifest

# Utilities
jeju cleanup          # Clean up orphaned processes
jeju dev --vendor-only  # Start only vendor apps
```

## Direct Script Usage (Legacy)

Scripts can still be run directly if needed, but CLI is preferred:

```bash
# Deployment scripts (use CLI instead)
bun run scripts/deploy/token.ts --network testnet
bun run scripts/deploy/oif.ts localnet
bun run scripts/deploy-testnet-full.ts  # Full testnet deployment
bun run scripts/deploy-dao-full.ts  # Full DAO deployment
bun run scripts/deploy-app.ts <name>  # App deployment
bun run scripts/deploy-frontend.ts <name>  # Frontend deployment
bun run scripts/rollback-deployment.ts --network=testnet --backup=latest

# Service scripts (use CLI instead)
bun run scripts/auto-update/update-manager.ts
bun run scripts/bridge/forced-inclusion-monitor.ts
bun run scripts/dispute/run-challenger.ts
bun run scripts/sequencer/run-consensus.ts

# Utility scripts
bun run scripts/cleanup-processes.ts  # Use: jeju cleanup
bun run scripts/dev-with-vendor.ts  # Use: jeju dev --vendor-only
```

## Scripts That Should Stay

These scripts are used internally by the CLI or are postinstall hooks:

- `bootstrap-localnet-complete.ts` - Used by `jeju dev`
- `setup-apps.ts` - Postinstall hook (runs after `bun install`)
- `setup-testnet-deployer.ts` - Setup script for testnet deployer
- `fund-testnet-deployer.ts` - Fund testnet deployer wallet
- `check-testnet-readiness.ts` - Used by `jeju deploy check`
- `verify-oif-deployment.ts` - Used by `jeju deploy verify oif`
- `publish-packages.ts` - Package publishing to npm
- `build.ts`, `clean.ts` - Build/clean utilities
- `shared/` - Utility library (imported, not run directly)
- Shell scripts (`*.sh`) - Testing utilities

## Shared Utilities

The `shared/` directory contains importable utilities (not run directly):

- `chains.ts` - Chain configuration
- `rpc.ts` - RPC helpers
- `logger.ts` - Logging
- `paymaster.ts` - Paymaster integration
- `eil.ts` - EIL (Ethereum Intent Layer)
- `discover-apps.ts` - App discovery
