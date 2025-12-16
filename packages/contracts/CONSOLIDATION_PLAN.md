# Contract Consolidation Plan

## Executive Summary

This document identifies duplicate contracts, unused contracts, and consolidation opportunities across the Jeju canonical contracts. The goal is to create a tighter, more integrated system that leverages ERC-8004, moderation, and governance consistently.

### Key Findings

**Duplicates to Remove:**
- ✅ `devtools/GitRegistry.sol` → Use `git/RepoRegistry.sol`
- ✅ `devtools/PackageRegistry.sol` → Use `pkg/PackageRegistry.sol`

**Major Consolidation Opportunities:**
- 🔄 Create `ProviderRegistryBase` for 5+ similar provider registries
- 🔄 Standardize ERC-8004 integration across all registries
- 🔄 Standardize moderation checks across all registries
- 🔄 Standardize governance patterns

**Contracts Requiring Migration:**
- ⚠️ `storage/FileStorageManager.sol` → Migrate to `StorageMarket + StorageProviderRegistry`

**Estimated Impact:**
- Code reduction: ~30% reduction in duplicate code
- Consistency: 100% ERC-8004 integration across provider registries
- Maintainability: Easier to add new provider types (<100 lines)

## 1. Duplicate Contracts

### 1.1 Git Registry Duplicates

**Issue:** Two separate Git registry implementations exist:
- `git/RepoRegistry.sol` - Full-featured with ERC-8004 integration, branch management, collaborators, forks
- `devtools/GitRegistry.sol` - Simpler version without ERC-8004 integration

**Plan:**
- **CONSOLIDATE** into `git/RepoRegistry.sol` (the canonical version)
- **REMOVE** `devtools/GitRegistry.sol`
- Ensure all features from devtools version are present in canonical version
- Update all imports/references to use `git/RepoRegistry.sol`

**Impact:** Low - devtools version appears to be legacy/unused

---

### 1.2 Package Registry Duplicates

**Issue:** Two separate NPM package registry implementations exist:
- `pkg/PackageRegistry.sol` - Full-featured with ERC-8004 integration, versioning, maintainers, scopes
- `devtools/PackageRegistry.sol` - Simpler version without ERC-8004 integration

**Plan:**
- **CONSOLIDATE** into `pkg/PackageRegistry.sol` (the canonical version)
- **REMOVE** `devtools/PackageRegistry.sol`
- Ensure all features from devtools version are present in canonical version
- Update all imports/references to use `pkg/PackageRegistry.sol`

**Impact:** Low - devtools version appears to be legacy/unused

---

## 2. Provider Registry Pattern Duplication

### 2.1 Similar Provider Registry Contracts

**Issue:** Multiple registries follow nearly identical patterns:
- `compute/ComputeRegistry.sol` - Compute providers with staking, ERC-8004 integration
- `storage/StorageProviderRegistry.sol` - Storage providers with staking, ERC-8004 integration
- `cdn/CDNRegistry.sol` - CDN providers with staking, ERC-8004 integration
- `messaging/MessageNodeRegistry.sol` - Messaging nodes with staking
- `sequencer/SequencerRegistry.sol` - Sequencers with staking, ERC-8004 integration
- `services/ServiceRegistry.sol` - Generic services (different pattern - pricing focused)

**Common Patterns:**
- Provider registration with stake
- ERC-8004 agent integration (optional/required)
- Active/inactive status management
- Staking management (add/withdraw)
- Performance metrics tracking
- Provider discovery by agent ID
- Slashing mechanisms

**Plan:**
- **CREATE** base `ProviderRegistryBase.sol` abstract contract with common functionality:
  - Registration with stake
  - ERC-8004 agent linking
  - Active/inactive status
  - Staking management
  - Basic provider info struct
- **REFACTOR** each registry to inherit from base:
  - `ComputeRegistry` → `ComputeProviderRegistry extends ProviderRegistryBase`
  - `StorageProviderRegistry` → `StorageProviderRegistry extends ProviderRegistryBase`
  - `CDNRegistry` → `CDNProviderRegistry extends ProviderRegistryBase`
  - `MessageNodeRegistry` → `MessageNodeRegistry extends ProviderRegistryBase`
  - `SequencerRegistry` → `SequencerRegistry extends ProviderRegistryBase`
- **KEEP** `ServiceRegistry` separate (different purpose - pricing/usage tracking)

**Benefits:**
- DRY principle - shared logic in one place
- Consistent ERC-8004 integration across all provider types
- Easier to add new provider types
- Unified moderation integration (ban checks, slashing)

**Impact:** Medium - Requires refactoring but improves maintainability

---

## 3. Staking System Consolidation

### 3.1 Multiple Staking Contracts

**Issue:** Several staking contracts with overlapping functionality:
- `rpc/RPCStakingManager.sol` - RPC access staking with USD tiers
- `staking/NodeStakingManager.sol` - Node operator staking with rewards
- `compute/ComputeStaking.sol` - Compute marketplace staking (user/provider/guardian)
- `staking/Staking.sol` - Paymaster/EIL staking pool (different purpose, keep)
- Various registry-specific staking (embedded in registries)

**Plan:**
- **KEEP** `staking/Staking.sol` - Different purpose (paymaster/EIL liquidity pool), actively used
- **KEEP** specialized staking contracts (RPC, Node, Compute) - they serve different purposes
- **STANDARDIZE** staking interfaces:
  - Common interface for ERC-8004 agent linking
  - Common interface for moderation integration (ban checks)
  - Common interface for slashing
- **CREATE** `IStaking.sol` interface that all staking contracts implement

**Impact:** Low-Medium - Standardization improves integration

---

## 4. Unused Contracts

### 4.1 Contracts to Review for Removal

**Candidates for removal:**
- `devtools/GitRegistry.sol` - ✅ **SAFE TO REMOVE** - No imports found, duplicate of `git/RepoRegistry.sol`
- `devtools/PackageRegistry.sol` - ✅ **SAFE TO REMOVE** - No imports found, duplicate of `pkg/PackageRegistry.sol`
- `storage/FileStorageManager.sol` - ⚠️ **IN USE** - Still referenced in gateway app, needs migration first
- `staking/Staking.sol` - ✅ **KEEP** - Different purpose (paymaster/EIL staking pool), actively used

**Plan:**
- **REMOVE** `devtools/GitRegistry.sol` and `devtools/PackageRegistry.sol` immediately
- **MIGRATE** `FileStorageManager` usage to `StorageMarket + StorageProviderRegistry`:
  - Update `apps/gateway/src/app/storage/page.tsx` to use new contracts
  - Update `apps/gateway/src/config/index.ts` to remove `fileStorageManager` config
  - Update `scripts/bootstrap-localnet-complete.ts` to remove `fileStorageManager` field
  - Then remove `storage/FileStorageManager.sol`

---

## 5. Integration Improvements

### 5.1 ERC-8004 Integration Standardization

**Issue:** Inconsistent ERC-8004 integration across contracts:
- Some contracts require agent registration (`requireAgentRegistration` flag)
- Some contracts have optional agent linking
- Some contracts don't integrate at all

**Plan:**
- **STANDARDIZE** ERC-8004 integration pattern:
  - All provider registries should support optional agent linking
  - All registries should check `IdentityRegistry` for bans
  - All registries should expose `getProviderByAgent(uint256 agentId)`
  - All registries should emit events when agents are linked
- **CREATE** `ERC8004ProviderMixin.sol` mixin contract with:
  - Agent linking logic
  - Ban checking logic
  - Agent-to-provider mapping
  - Standard events

**Impact:** High - Improves canonical contract consistency

---

### 5.2 Moderation Integration

**Issue:** Moderation checks are inconsistent:
- Some contracts check `BanManager` directly
- Some contracts check `IdentityRegistry.isBanned()`
- Some contracts don't check at all

**Plan:**
- **STANDARDIZE** moderation checks:
  - All registries should check `BanManager.isAddressBanned(address)` for address-level bans
  - All registries should check `IdentityRegistry.getAgent(agentId).isBanned` for agent-level bans
  - Create `ModerationMixin.sol` with standard ban checking logic
- **INTEGRATE** `ReportingSystem` with all registries:
  - Allow reporting providers/agents directly from registries
  - Link reports to agent IDs for cross-app visibility

**Impact:** High - Critical for network security

---

### 5.3 Governance Integration

**Issue:** Governance integration is inconsistent:
- Some contracts use `RegistryGovernance` for futarchy decisions
- Some contracts have owner-only functions
- Some contracts have no governance

**Plan:**
- **STANDARDIZE** governance pattern:
  - Critical operations (bans, slashing) → `RegistryGovernance` futarchy
  - Parameter updates → Owner or governance timelock
  - Emergency pauses → Owner or multi-sig
- **CREATE** `GovernanceMixin.sol` with:
  - Standard governance checks
  - Timelock integration
  - Proposal linking

**Impact:** Medium - Improves decentralization

---

## 6. Specific Consolidation Opportunities

### 6.1 Registry Discovery Functions

**Issue:** Each registry implements its own discovery functions:
- `getActiveProviders()`
- `getProviderByAgent()`
- `getProvidersByRegion()` (some registries)

**Plan:**
- **STANDARDIZE** discovery interface:
  - `IProviderRegistry.sol` interface with standard discovery functions
  - All provider registries implement this interface
  - Enables unified discovery across all provider types

---

### 6.2 Performance Metrics

**Issue:** Each registry tracks performance differently:
- `MessageNodeRegistry` has `PerformanceMetrics` struct
- `SequencerRegistry` tracks blocks proposed/missed
- `CDNRegistry` tracks cache hit rates, latency
- `ComputeRegistry` tracks capabilities

**Plan:**
- **CREATE** `PerformanceMetrics.sol` library with:
  - Standard metrics struct
  - Standard aggregation functions
  - Standard scoring functions
- **REFACTOR** registries to use standard metrics where applicable

---

### 6.3 Staking Management

**Issue:** Each registry implements staking management differently:
- Different minimum stakes
- Different withdrawal delays
- Different slashing mechanisms

**Plan:**
- **STANDARDIZE** staking parameters:
  - Common minimum stake tiers (Small/Medium/High)
  - Common withdrawal delay (7 days)
  - Common slashing percentages (configurable per registry)
- **CREATE** `StakingManager.sol` library with:
  - Standard staking functions
  - Standard withdrawal logic
  - Standard slashing logic

---

## 7. Implementation Priority

### Phase 1: Quick Wins (Low Risk) ✅ COMPLETE
1. ✅ Remove duplicate Git/Package registries (1.1, 1.2) - **COMPLETE**
   - Deleted `devtools/GitRegistry.sol` (use `git/RepoRegistry.sol`)
   - Deleted `devtools/PackageRegistry.sol` (use `pkg/PackageRegistry.sol`)
   - Deleted empty `devtools/` folder
2. ✅ Remove unused contracts (4.1) - **COMPLETE**
   - Deleted `rollup/ForcedInclusion.sol` (duplicate of `bridge/ForcedInclusion.sol`)
   - Deleted `tokens/JejuPresale.sol` (duplicate of `tokens/Presale.sol`)
   - Deleted `storage/StorageLedgerManager.sol` (use `compute/LedgerManager.sol`)
3. ✅ Standardize ERC-8004 integration (5.1) - **COMPLETE**
   - Created `ERC8004ProviderMixin.sol` library
   - Created `ModerationMixin.sol` library  
   - Created `ProviderRegistryBase.sol` abstract contract
   - All provide standardized patterns for provider registries
4. ✅ Standardize staking interfaces - **COMPLETE**
   - Created `staking/BaseStaking.sol` abstract contract
   - Created `staking/IStaking.sol` common interface
   - Created `IStakingWithModeration`, `IStakingWithTiers`, `IStakingWithRewards` extended interfaces
5. ✅ Add BanManager integration - **COMPLETE**
   - Added ModerationMixin to `cdn/CDNRegistry.sol`
   - Added ModerationMixin to `storage/StorageProviderRegistry.sol`
6. ✅ Rename ambiguous contracts - **COMPLETE**
   - Renamed `launchpad/Presale.sol` → `launchpad/TieredPresale.sol` (multi-token, USD tiers)
   - `tokens/Presale.sol` is canonical for ETH-only presales with CCA auction support

### Phase 2: Refactoring (Medium Risk)
1. ✅ Create ProviderRegistryBase (2.1) - **COMPLETE** (already existed)
2. ⏳ Refactor registries to inherit from ProviderRegistryBase
3. ✅ Standardize moderation integration (5.2) - **COMPLETE** via ModerationMixin

### Phase 3: Advanced Consolidation (Higher Risk)
1. ⏳ Standardize governance integration (5.3)
2. ⏳ Create standard interfaces/libraries (6.1, 6.2, 6.3)
3. ⏳ Refactor to use standard components

---

## 8. Testing Strategy

For each consolidation:
1. **Unit tests** for new base contracts/mixins
2. **Integration tests** for refactored registries
3. **E2E tests** for cross-contract interactions
4. **Migration tests** to verify no breaking changes

---

## 9. Migration Plan

1. **Deploy** new base contracts/mixins
2. **Deploy** refactored registries (new addresses)
3. **Migrate** existing providers to new registries (if needed)
4. **Deprecate** old contracts
5. **Update** all references in codebase

---

## 10. Success Metrics

- Reduced code duplication (target: 30% reduction)
- Consistent ERC-8004 integration across all registries
- Consistent moderation checks across all registries
- Standardized governance patterns
- Easier to add new provider types (target: <100 lines for new registry)
