# Scripts

Utility scripts and deployment orchestration for Jeju Network.

**⚠️ Most scripts have been migrated to CLI commands. Use `jeju <command>` instead.**

## Structure

```
scripts/
├── shared/                    # Utility library (imported, not run directly)
├── deploy/                    # Deployment scripts (run via CLI: jeju deploy)
├── bootstrap-localnet-complete.ts  # Used by CLI for localnet setup
├── setup-apps.ts              # Postinstall app setup (kept for postinstall hook)
├── check-testnet-readiness.ts # Testnet readiness (used by CLI: jeju deploy check)
├── verify-oif-deployment.ts   # OIF verification (used by CLI: jeju deploy verify)
├── setup-testnet-deployer.ts  # Setup testnet deployer (migrate to CLI)
├── fund-testnet-deployer.ts   # Fund testnet deployer (migrate to CLI)
├── deploy-app.ts              # App deployment (migrate to CLI)
├── deploy-dao-full.ts         # DAO deployment (migrate to CLI)
├── deploy-frontend.ts         # Frontend deployment (migrate to CLI)
├── deploy-testnet-full.ts     # Testnet deployment (migrate to CLI)
├── deploy.ts                  # Main deployment (migrate to CLI)
├── rollback-deployment.ts     # Rollback (migrate to CLI)
├── publish-packages.ts        # Publish packages (migrate to CLI)
├── dev-with-vendor.ts         # Vendor apps (migrate to CLI)
└── *.sh                       # Shell scripts for Go testing (keep)
```

## Usage

**All operations should use the Jeju CLI:**

```bash
# Development
jeju dev              # Start localnet + apps
jeju dev --minimal    # Localnet only
jeju dev --vendor-only  # Start only vendor apps

# Building & Cleaning
jeju build            # Build all components
jeju clean            # Clean build artifacts
jeju clean --deep     # Deep clean (includes Docker)
jeju cleanup          # Cleanup orphaned processes

# Testing
jeju test             # Run all tests
jeju test --mode=unit
jeju test --app=bazaar

# Deployment
jeju deploy testnet --token
jeju deploy check testnet      # Comprehensive readiness check
jeju deploy verify oif testnet # Verify OIF deployments
jeju deploy status testnet     # Check deployment status

# Apps & Ports
jeju apps             # List all apps (core + vendor)
jeju ports            # Check port configuration

# Status
jeju status           # Check running services
jeju keys             # Show dev keys + MetaMask config
```

## Scripts That Should Stay

These scripts are used internally by the CLI or are postinstall hooks:

- `bootstrap-localnet-complete.ts` - Used by `jeju dev` for localnet bootstrap
- `setup-apps.ts` - Postinstall hook (runs after `bun install`)
- `check-testnet-readiness.ts` - Used by `jeju deploy check` (will be migrated)
- `verify-oif-deployment.ts` - Used by `jeju deploy verify oif` (will be migrated)
- `shared/` - Utility library (imported, not run directly)
- Shell scripts (`*.sh`) - Testing utilities for Go code

## Scripts To Be Migrated

These scripts should be migrated to CLI commands:

- `setup-testnet-deployer.ts` → `jeju keys setup-testnet`
- `fund-testnet-deployer.ts` → `jeju fund testnet`
- `deploy-app.ts` → `jeju deploy app`
- `deploy-dao-full.ts` → `jeju deploy dao-full`
- `deploy-frontend.ts` → `jeju deploy frontend`
- `deploy-testnet-full.ts` → `jeju deploy testnet-full`
- `deploy.ts` → Already handled by `jeju deploy`
- `rollback-deployment.ts` → `jeju deploy rollback`
- `publish-packages.ts` → `jeju publish`
- `dev-with-vendor.ts` → `jeju dev --vendor-only`

## Shared Utilities

The `shared/` directory contains importable utilities (not run directly):

- `chains.ts` - Chain configuration
- `rpc.ts` - RPC helpers
- `logger.ts` - Logging
- `paymaster.ts` - Paymaster integration
- `eil.ts` - EIL (Ethereum Intent Layer)
- `discover-apps.ts` - App discovery
- `chain-utils.ts` - Chain utilities
