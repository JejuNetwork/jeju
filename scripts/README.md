# Scripts

Utility scripts and deployment orchestration for Jeju Network.

**⚠️ All scripts have been migrated to CLI commands. Use `jeju <command>` instead.**

## Structure

```
scripts/
├── shared/                    # Utility library (imported by CLI and scripts)
│
├── bootstrap/                 # Bootstrap scripts
│   └── bootstrap-localnet-complete.ts  # Internal: Used by CLI dev command
│
├── deploy/                    # Deployment scripts (called by CLI: jeju deploy *)
│   ├── deploy-app.ts         # Internal: Used by CLI deploy app
│   ├── deploy-frontend.ts    # Internal: Used by CLI deploy frontend
│   ├── rollback-deployment.ts # Internal: Used by CLI deploy rollback
│   ├── testnet-full.ts       # Full testnet deployment (operator keys, L1, L2 genesis, K8s)
│   ├── testnet-full-crosschain.ts  # Cross-chain testnet deployment (OIF, XLP)
│   └── [other deploy scripts] # Token, OIF, JNS, etc.
│
├── keys/                      # Key management scripts
│   ├── setup-testnet-deployer.ts  # Internal: Used by CLI keys setup-testnet
│   └── fund-testnet-deployer.ts   # Internal: Used by CLI fund --testnet
│
├── verify/                    # Verification scripts
│   ├── check-testnet-readiness.ts  # Internal: Used by CLI deploy check
│   └── verify-oif-deployment.ts    # Internal: Used by CLI deploy verify oif
│
├── testing/                   # Testing utilities
│   ├── test-go-docker.sh     # Go testing with Docker
│   ├── test-integration.sh    # Integration tests
│   └── verify-go-compile.sh  # Go compilation verification
│
├── auto-update/               # Service scripts (called by CLI: jeju service auto-update)
├── bridge/                    # Service scripts (called by CLI: jeju service bridge)
├── dispute/                   # Service scripts (called by CLI: jeju service dispute)
├── sequencer/                 # Service scripts (called by CLI: jeju service sequencer)
├── oracle/                    # Oracle deployment (called by CLI: jeju deploy oracle)
├── governance/                # Governance deployment (called by CLI: jeju deploy governance)
├── vendor/                    # Vendor manifest tools (called by CLI: jeju init vendor)
│
└── setup-apps.ts              # Postinstall hook (runs after bun install)
```

## Usage

**All operations should use the Jeju CLI:**

```bash
# Development
jeju dev              # Start localnet + apps
jeju dev --minimal    # Localnet only
jeju dev --vendor-only  # Start only vendor apps
jeju dev --bootstrap  # Force contract bootstrap

# Building & Cleaning
jeju build            # Build all components
jeju clean            # Clean build artifacts
jeju clean --deep     # Deep clean (includes Docker)
jeju cleanup          # Cleanup orphaned processes

# Testing
jeju test             # Run all tests
jeju test --mode=unit
jeju test --app=bazaar

# Keys & Funding
jeju keys             # Show dev keys + MetaMask config
jeju keys genesis     # Generate production keys
jeju keys setup-testnet  # Setup testnet deployer wallet
jeju fund              # Fund localnet accounts
jeju fund --testnet    # Fund testnet deployer across all testnets
jeju fund --testnet --bridge  # Bridge ETH to L2s

# Deployment
jeju deploy testnet --token
jeju deploy check testnet      # Comprehensive readiness check
jeju deploy verify oif testnet # Verify OIF deployments
jeju deploy status testnet     # Check deployment status
jeju deploy token --network testnet
jeju deploy oif --network testnet
jeju deploy jns --network testnet
jeju deploy dao-full --network testnet
jeju deploy testnet-full       # Full testnet deployment
jeju deploy app <name>         # Deploy an app
jeju deploy frontend <name>    # Deploy frontend to IPFS+JNS
jeju deploy rollback --network testnet --backup latest

# Services (Long-running processes)
jeju service auto-update --network testnet
jeju service bridge --network testnet
jeju service dispute --network testnet
jeju service sequencer --network testnet
jeju service list              # List running services
jeju service stop <name>        # Stop a service

# Apps & Ports
jeju apps             # List all apps (core + vendor)
jeju ports            # Check port configuration

# Publishing
jeju publish          # Publish workspace packages to npm
jeju publish --dry-run  # Simulate publishing

# Status
jeju status           # Check running services
```

## Script Organization

### Internal Scripts (Called by CLI)

These scripts are organized by category and called internally by CLI commands:

**Bootstrap:**
- `bootstrap/bootstrap-localnet-complete.ts` - Used by `jeju dev` for contract bootstrap

**Deployment:**
- `deploy/deploy-app.ts` - Used by `jeju deploy app`
- `deploy/deploy-frontend.ts` - Used by `jeju deploy frontend`
- `deploy/rollback-deployment.ts` - Used by `jeju deploy rollback`
- `deploy/testnet-full-crosschain.ts` - Used by `jeju deploy testnet-full`
- `deploy/*.ts` - Used by `jeju deploy *` subcommands

**Keys:**
- `keys/setup-testnet-deployer.ts` - Used by `jeju keys setup-testnet`
- `keys/fund-testnet-deployer.ts` - Used by `jeju fund --testnet`

**Verification:**
- `verify/check-testnet-readiness.ts` - Used by `jeju deploy check`
- `verify/verify-oif-deployment.ts` - Used by `jeju deploy verify oif`

**Services:**
- `auto-update/update-manager.ts` - Used by `jeju service auto-update`
- `bridge/forced-inclusion-monitor.ts` - Used by `jeju service bridge`
- `dispute/run-challenger.ts` - Used by `jeju service dispute`
- `sequencer/run-consensus.ts` - Used by `jeju service sequencer`

**Other:**
- `oracle/deploy-and-configure.ts` - Used by `jeju deploy oracle`
- `governance/deploy-security-council.ts` - Used by `jeju deploy governance`
- `vendor/create-vendor-manifest.ts` - Used by `jeju init vendor`

### Postinstall Hook

- `setup-apps.ts` - Runs after `bun install` (configured in package.json)

### Testing Utilities

- `testing/test-go-docker.sh` - Go testing with Docker
- `testing/test-integration.sh` - Integration tests for decentralization contracts
- `testing/verify-go-compile.sh` - Go compilation verification

### Shared Utilities

- `shared/` - Utility library (imported by CLI and scripts, not run directly)

## Migration Status

✅ **Fully Migrated to CLI:**
- `build.ts` → `jeju build` (DELETED)
- `clean.ts` → `jeju clean` (DELETED)
- `cleanup-processes.ts` → `jeju cleanup` (DELETED)
- `list-apps.ts` → `jeju apps` (DELETED)
- `check-ports.ts` → `jeju ports` (DELETED)
- `publish-packages.ts` → `jeju publish` (DELETED)
- `dev.ts` → `jeju dev` (DELETED - was just a wrapper)
- `dev-with-vendor.ts` → `jeju dev --vendor-only` (DELETED)
- `deploy.ts` → `jeju deploy` (DELETED)
- `bootstrap-localnet.ts` → Integrated into `jeju dev` (DELETED)
- `deploy-dao-full.ts` → `jeju deploy dao-full` (moved to deploy/)
- `validate-manifests.ts` → `jeju validate manifests` (DELETED - logic moved to CLI)
- All `packages/bridge/scripts/*.ts` → DELETED (deploy scripts removed)
- All `packages/contracts/scripts/*.ts` → DELETED (deploy scripts removed)
- All `packages/token/scripts/*.ts` → DELETED (deploy scripts removed)

✅ **Scripts That Remain (Internal Use):**
- `deploy/testnet.ts` - Used by CLI for testnet contract deployment
- `deploy/mainnet.ts` - Used by CLI for mainnet contract deployment
- `deploy/oif.ts` - Used by CLI for OIF deployment
- `deploy/testnet-full.ts` - Used by CLI for full testnet deployment
- All other `deploy/*.ts` scripts - Used by `jeju deploy <subcommand>`

✅ **Organized into Folders:**
- Bootstrap scripts → `bootstrap/`
- Deployment scripts → `deploy/`
- Key management → `keys/`
- Verification scripts → `verify/`
- Testing utilities → `testing/`

## Direct Script Usage (Not Recommended)

Scripts can still be run directly if needed, but CLI is preferred:

```bash
# These are internal - use CLI instead
bun run scripts/bootstrap/bootstrap-localnet-complete.ts
bun run scripts/verify/check-testnet-readiness.ts
bun run scripts/verify/verify-oif-deployment.ts testnet
bun run scripts/keys/setup-testnet-deployer.ts
bun run scripts/keys/fund-testnet-deployer.ts --bridge
bun run scripts/deploy/testnet-full-crosschain.ts
bun run scripts/deploy/deploy-app.ts --name myapp --dir dist --jns myapp.jeju
bun run scripts/deploy/deploy-frontend.ts leaderboard --network testnet
bun run scripts/deploy/rollback-deployment.ts --network=testnet --backup=latest

# Service scripts (use CLI instead)
bun run scripts/auto-update/update-manager.ts
bun run scripts/bridge/forced-inclusion-monitor.ts
bun run scripts/dispute/run-challenger.ts
bun run scripts/sequencer/run-consensus.ts

# Deployment scripts (use CLI instead)
bun run scripts/deploy/token.ts --network testnet
bun run scripts/deploy/oif.ts localnet
bun run scripts/deploy/jns.ts --network testnet

# Testing utilities
bash scripts/testing/test-go-docker.sh
bash scripts/testing/test-integration.sh
bash scripts/testing/verify-go-compile.sh
```

## Shared Utilities

The `shared/` directory contains importable utilities (not run directly):

- `chains.ts` - Chain configuration
- `rpc.ts` - RPC helpers
- `logger.ts` - Logging
- `paymaster.ts` - Paymaster integration
- `eil.ts` - EIL (Ethereum Intent Layer)
- `discover-apps.ts` - App discovery
- `chain-utils.ts` - Chain utilities
- `jns.ts` - JNS (Jeju Name Service) utilities
- `x402-client.ts` - x402 payment client
- `agent0.ts` - Agent0 integration
- `cloud-integration.ts` - Cloud service integration
- And more...

