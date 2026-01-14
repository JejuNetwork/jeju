# Changelog

## [Unreleased] - 2026-01-14

### 🐛 Bug Fixes

#### Indexer & Bazaar Integration
- **Fixed Bazaar API server not starting in `jeju dev`**
  - Updated `packages/cli/src/commands/dev.ts` to start core app backends (not just vendor apps)
  - Created missing `apps/bazaar/api/server.ts` entry point for standalone API server
  - Fixed command parsing for `bun --watch` commands in orchestrator
  - **Impact**: Bazaar API server now starts correctly, enabling GraphQL proxy endpoint

- **Fixed GraphQL proxy returning 500 errors**
  - Modified `/api/graphql` endpoint in `apps/bazaar/api/worker.ts` to return HTTP 200 for all responses (GraphQL spec compliance)
  - Errors are now returned in response body instead of HTTP status codes
  - Improved body parsing to handle both string and object formats
  - Added better error logging and Content-Type headers
  - **Impact**: Frontend can now successfully communicate with indexer, coins page populates correctly

- **Fixed seed-state endpoint returning 500 errors**
  - Changed `/api/seed-state` endpoint to always return HTTP 200 with empty arrays when file is missing
  - Improved error handling with proper status codes and headers
  - **Impact**: Frontend no longer shows 500 errors when seed file doesn't exist

#### OAuth3 Authentication
- **Fixed OAuth3 network detection bug**
  - Updated network detection in `apps/bazaar/web/config/network.ts` and `wagmi.ts` to check for `.local.jejunetwork.org` BEFORE checking for mainnet
  - Previously `.local.jejunetwork.org` was incorrectly detected as mainnet
  - **Impact**: OAuth3 now correctly detects localnet environment

- **Fixed OAuth3 chain ID constants**
  - Corrected `CHAIN_IDS.localnet` from `420691` to `31337` in `packages/auth/src/infrastructure/config.ts`
  - Fixed `CHAIN_IDS.mainnet` from `420692` to `420691`
  - **Impact**: MetaMask now shows correct network ("Jeju Localnet" with Chain ID 31337) instead of "Jeju Mainnet" with wrong chain ID

- **Fixed OAuth3 decentralized discovery in localnet**
  - Changed OAuth3 client to only enable decentralized discovery when `decentralized === true` (not `!== false`)
  - Updated React provider to respect decentralized flag
  - Added check in auto-initialization to prevent discovery attempts when disabled
  - **Impact**: Eliminates console errors about `rpc.jejunetwork.org` not resolving in localnet

#### Indexer Improvements
- **Fixed indexer processor path**
  - Changed orchestrator to run `api/main.ts` directly with Bun instead of requiring build step
  - **Impact**: Indexer processor starts correctly without compilation errors

- **Fixed indexer REST server network detection**
  - Added explicit `CHAIN_ID: '31337'` and `JEJU_NETWORK: 'localnet'` environment variables
  - **Impact**: REST API correctly reports chainId 31337 instead of 420691

- **Added missing dependencies to indexer**
  - Added `@jejunetwork/cache` and `@jejunetwork/config` to `apps/indexer/package.json`
  - **Impact**: Indexer REST server starts without module errors

#### Deployment & Infrastructure
- **Improved deployment error handling**
  - Enhanced `deployWorker` error handling in `packages/cli/src/lib/deploy-app-onchain.ts`
  - Now gracefully handles `RouteAlreadyRegistered`, `CIDAlreadyExists`, and other revert errors
  - **Impact**: Deployment continues even if routes/CIDs already exist on-chain

- **Fixed port conflicts**
  - Changed `WALLET` service port from `4015` to `4018` in `packages/config/ports.ts`
  - Resolved conflict with `COMPUTE` service
  - **Impact**: Both services can run simultaneously without port conflicts

### 📝 Files Changed

#### Core Fixes (Most Recent Commit)
- `apps/bazaar/api/server.ts` - New API server entry point
- `apps/bazaar/api/worker.ts` - GraphQL proxy fixes, error handling improvements
- `apps/bazaar/web/App.tsx` - OAuth3 configuration updates
- `apps/bazaar/web/config/network.ts` - Network detection fix
- `apps/bazaar/web/config/wagmi.ts` - Network detection fix
- `packages/auth/src/infrastructure/config.ts` - Chain ID constants fix
- `packages/auth/src/sdk/client.ts` - Decentralized discovery fix
- `packages/auth/src/react/provider.tsx` - Decentralized discovery fix
- `packages/cli/src/commands/dev.ts` - Core app backend startup fix
- `packages/cli/src/lib/deploy-app-onchain.ts` - Deployment error handling
- `packages/cli/src/services/orchestrator.ts` - Indexer processor path fix
- `packages/config/ports.ts` - Port conflict resolution
- `apps/indexer/package.json` - Missing dependencies added

### 🔧 Technical Details

#### GraphQL Proxy Implementation
The GraphQL proxy now follows the GraphQL specification by always returning HTTP 200, with errors included in the response body. This ensures compatibility with GraphQL clients that expect successful HTTP responses even when queries contain errors.

#### Network Detection Priority
Network detection now follows this priority order:
1. Localhost/IP addresses → `localnet`
2. `.local.jejunetwork.org` → `localnet` (checked before mainnet)
3. `.testnet.jejunetwork.org` → `testnet`
4. `.jejunetwork.org` → `mainnet` (only if not matched above)

#### OAuth3 Chain ID Resolution
OAuth3 now correctly uses:
- `31337` for localnet (Anvil/Foundry default)
- `420690` for testnet
- `420691` for mainnet

### ✅ Testing Notes

- Bazaar Coins page now successfully loads and displays seeded tokens
- OAuth3 login works correctly with MetaMask showing proper network
- No console errors related to OAuth3 decentralized discovery
- Indexer shows as "online" in frontend health checks
- GraphQL queries return proper responses (HTTP 200 with data/errors in body)

### 📚 Related Issues

These fixes resolve issues where:
- Indexer appeared offline on Bazaar Coins page
- OAuth3 login showed wrong network/chain ID in MetaMask
- Console errors about `rpc.jejunetwork.org` not resolving
- GraphQL proxy returning 500 errors
- Seed-state endpoint causing frontend errors

---

## Previous Changes

### Test & Build Fixes
- Fixed various test configurations and build issues across multiple apps
- Added missing stub files for browser builds
- Improved CI workflow configurations

### Crucible Enhancements
- Added structured alert escalation system
- Implemented monitoring agents and infrastructure analysis
- Added security analyst agent with contract auditing capabilities

### Documentation
- Comprehensive documentation updates across all applications
- Added API reference documentation
- Improved deployment guides

### Infrastructure
- Updated localnet contract addresses
- Added SKIP_SQLIT option for indexer development
- Improved local development reliability
