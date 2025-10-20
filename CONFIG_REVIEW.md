# Config Directory Review - Unused Items Analysis

## Summary

After thorough review of the `/config` directory, the following items have been identified as unused or minimally used.

---

## ✅ ACTIVELY USED Config Files

### Core Configuration Files (Keep)
1. **`index.ts`** - Main config loader, heavily used across codebase
2. **`jeju-defaults.ts`** - Default values and constants, used in multiple scripts
3. **`ports.ts`** - Port allocation system, used by `scripts/dev.ts` and `scripts/check-ports.ts`
4. **`chain/*.json`** - Network configurations loaded by `index.ts`, used throughout

### Token Configuration (Keep)
5. **`base-tokens.json`** - Used by `scripts/shared/token-utils.ts` for Base chain tokens
6. **`jeju-tokens.json`** - Used by `apps/bazaar/config/tokens.ts` for Jeju tokens  
7. **`protocol-tokens.json`** - Used by `scripts/shared/protocol-tokens.ts` and `apps/gateway`

### Deployment Templates (Keep - Used as inputs)
8. **`deploy-configs/*.json`** - Input files for `scripts/generate-genesis.sh`
9. **`genesis/*.json`** - Template/example files (generated during actual deployment)
10. **`rollup/*.json`** - Template/example files (generated during actual deployment)

---

## ❌ UNUSED Config Files (To Delete)

### 1. `base-networks.json`
**Status:** UNUSED  
**Reason:**
- Contains Base Mainnet and Base Sepolia network info
- `loadBaseNetworks()` function exists in `config/index.ts` but is NEVER called
- Only usage is in test file (`config/index.test.ts`)
- This information is already available in `chain/*.json` files under `l1ChainId` and `l1RpcUrl`
- Duplicate data that's never actually used

**Evidence:**
```bash
# Only found in tests, never in actual code
grep -r "loadBaseNetworks(" --include="*.ts" --include="*.tsx" --exclude="*.test.ts"
# Returns: 0 results
```

**Impact of deletion:** None - function is never called

---

### 2. `localnet-config.json`
**Status:** UNUSED  
**Reason:**
- Contains localnet configuration with deployment addresses and test accounts
- Only referenced in README documentation
- Never imported, required, or read by any actual code
- Information is duplicated in:
  - `chain/localnet.json` (for chain config)
  - `jeju-defaults.ts` (for test accounts via `JEJU_LOCALNET_ACCOUNTS`)
  - Deployment scripts generate addresses dynamically

**Evidence:**
```bash
# Check for any imports or requires
grep -r "localnet-config" --include="*.ts" --include="*.tsx" --include="*.js"
# Returns: Only found in config/README.md
```

**Impact of deletion:** None - purely documentation artifact

---

## 🔍 Detailed Analysis

### What We Checked

1. **Direct imports/requires** - Searched for `import` and `require` statements
2. **Dynamic loads** - Searched for `readFileSync`, `Bun.file()` patterns
3. **String references** - Searched for filename strings in all code
4. **Function usage** - Tracked where exported functions are actually called

### Files Analyzed
- ✅ All TypeScript/JavaScript files in `scripts/`
- ✅ All TypeScript/JavaScript files in `apps/*/`
- ✅ All shell scripts
- ✅ All configuration and documentation files

---

## 📋 Recommendations

### Immediate Actions
1. **DELETE** `config/base-networks.json`
2. **DELETE** `config/localnet-config.json`
3. **REMOVE** `loadBaseNetworks()` function from `config/index.ts`
4. **UPDATE** `config/README.md` to remove references to deleted files

### Documentation Updates
5. **CLARIFY** in `deploy-configs/README.md` that these are INPUT files for genesis generation
6. **CLARIFY** in `genesis/README.md` that these are TEMPLATE files (actual files generated during deployment)
7. **CLARIFY** in `rollup/README.md` that these are TEMPLATE files (actual files generated during deployment)

---

## 🎯 Why These Files Exist But Aren't Used

### base-networks.json
- Likely created early in development as a reference for Base chain info
- Information was later integrated into `chain/*.json` files (l1ChainId, l1RpcUrl fields)
- Function was added to `index.ts` but never actually needed
- Remained because tests were written for it

### localnet-config.json
- Created as a comprehensive reference document for localnet setup
- Information is now handled dynamically or stored in other configs:
  - Test accounts → `jeju-defaults.ts` (JEJU_LOCALNET_ACCOUNTS)
  - Chain config → `chain/localnet.json`
  - Deployment addresses → Generated at runtime and saved to `.kurtosis/` directory
- Serves no functional purpose, only documentation

---

## ✅ Validation

After deletion, these commands should still work:
```bash
# All tests pass
bun test config/index.test.ts

# Config loading works
bun run scripts/validate-config.ts

# Port checking works
bun run scripts/check-ports.ts

# Dev environment starts
bun run dev
```

The only changes needed:
1. Remove test cases for `loadBaseNetworks()` from `config/index.test.ts`
2. Update README references

---

## 📊 Summary Statistics

**Total config files:** 15
**Actively used:** 10 (67%)
**Templates (keep):** 3 (20%)
**Unused (delete):** 2 (13%)

**Total size to delete:** ~4 KB
**Lines of code to remove:** ~150 lines

