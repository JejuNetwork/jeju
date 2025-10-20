># Gateway Portal - Comprehensive Test Suite
## Overview

This test suite provides complete coverage of the Gateway Portal, including:

1. **E2E UX Flow Tests** - Playwright + Synpress with MetaMask automation
2. **Programmatic Contract Tests** - Direct contract interaction via viem
3. **A2A Agent Tests** - Agent-to-agent protocol communication

## Test Structure

```
tests/
├── e2e/                    # End-to-end frontend tests with MetaMask
│   ├── 01-wallet-connection.spec.ts
│   ├── 02-token-registry.spec.ts
│   ├── 03-bridge-tokens.spec.ts
│   ├── 04-deploy-paymaster.spec.ts
│   ├── 05-liquidity-provision.spec.ts
│   ├── 06-node-staking.spec.ts
│   └── 07-app-registry.spec.ts
├── contracts/              # Programmatic contract interaction tests
│   ├── token-registry.test.ts
│   ├── paymaster-factory.test.ts
│   ├── liquidity-vault.test.ts
│   ├── node-staking.test.ts
│   └── identity-registry.test.ts
├── a2a/                    # Agent-to-agent protocol tests
│   ├── agent-discovery.test.ts
│   └── governance-agent.test.ts
├── integration/            # Full flow integration tests
│   └── full-flow.spec.ts
└── fixtures/               # Shared test utilities
    ├── wallet.ts
    └── contracts.ts
```

## Running Tests

### All Tests
```bash
bun test
```

### E2E Tests Only (Requires running servers)
```bash
# Start dev servers first
bun run dev

# In another terminal
bun run test:e2e
```

### Contract Tests Only
```bash
bun run test:contracts
```

### A2A Agent Tests Only
```bash
# Start A2A server first
bun run dev:a2a

# In another terminal
bun run test:a2a
```

### Watch Mode
```bash
bun run test:watch
```

## Prerequisites

### 1. Running Localnet
Tests require Jeju localnet running:
```bash
# From repo root
bun run dev
```

This starts:
- Localnet on port 9545
- Gateway UI on port 4001
- A2A server on port 4003

### 2. Deployed Contracts
Contracts must be deployed:
```bash
bun run scripts/deploy-paymaster-system.ts
```

### 3. Environment Variables
Create `.env.local` with deployed addresses:
```bash
VITE_TOKEN_REGISTRY_ADDRESS=0x...
VITE_PAYMASTER_FACTORY_ADDRESS=0x...
VITE_PRICE_ORACLE_ADDRESS=0x...
VITE_NODE_STAKING_MANAGER_ADDRESS=0x...
VITE_IDENTITY_REGISTRY_ADDRESS=0x...
VITE_ELIZAOS_TOKEN_ADDRESS=0x...
```

## Test Coverage

### E2E UX Flows (7 test files, ~50 tests)

#### 1. Wallet Connection (`01-wallet-connection.spec.ts`)
- ✅ Display connect prompt
- ✅ Connect MetaMask wallet
- ✅ Display token balances
- ✅ Show navigation tabs
- ✅ Display wallet address in header

#### 2. Token Registry (`02-token-registry.spec.ts`)
- ✅ Display registered tokens list
- ✅ Show register form
- ✅ Validate token address format
- ✅ Validate fee ranges
- ✅ Prevent fees above 5%
- ✅ Display registration fee
- ✅ Show token details in cards

#### 3. Bridge Tokens (`03-bridge-tokens.spec.ts`)
- ✅ Display bridge interface
- ✅ Show elizaOS warning (native token)
- ✅ Only show bridgeable tokens
- ✅ Allow custom token address
- ✅ Validate amount input
- ✅ Optional recipient address
- ✅ Display bridge information
- ✅ Validate custom address format

#### 4. Deploy Paymaster (`04-deploy-paymaster.spec.ts`)
- ✅ Display deployment interface
- ✅ Show factory deployment info
- ✅ Include ALL tokens (including elizaOS)
- ✅ Warn if token not registered
- ✅ Display fee margin slider
- ✅ Show deployment cost estimate
- ✅ Warn if already deployed
- ✅ Update selected fee percentage

#### 5. Liquidity Provision (`05-liquidity-provision.spec.ts`)
- ✅ Display add liquidity interface
- ✅ Show liquidity info box
- ✅ Include all tokens in selector
- ✅ Warn if paymaster not deployed
- ✅ Validate ETH amount input
- ✅ Display LP position if exists
- ✅ Show fee earnings
- ✅ LP Dashboard with all positions
- ✅ Claim button for pending fees

#### 6. Node Staking (`06-node-staking.spec.ts`)
- ✅ Display node staking interface
- ✅ Show network overview
- ✅ Display my nodes section
- ✅ Register node form
- ✅ Staking token selector (all tokens)
- ✅ Reward token selector (can differ)
- ✅ Validate minimum stake ($1000 USD)
- ✅ Calculate USD value
- ✅ RPC URL input
- ✅ Geographic region selector
- ✅ Show bonus for underserved regions
- ✅ Show staking requirements
- ✅ Estimate monthly rewards
- ✅ Enforce max 5 nodes per operator
- ✅ Display node management UI
- ✅ Show claim and deregister buttons

#### 7. App Registry (`07-app-registry.spec.ts`)
- ✅ Display registry interface
- ✅ Show browse and register sections
- ✅ Display registered apps list
- ✅ Filter apps by tag
- ✅ Display app cards with metadata
- ✅ Show A2A enabled badge
- ✅ Open app detail modal
- ✅ Registration form validation
- ✅ Tag selection (multiple)
- ✅ Stake token selector
- ✅ Calculate required stake
- ✅ Show refundable stake info

### Contract Tests (5 test files, ~25 tests)

#### TokenRegistry Contract
- ✅ Read registration fee
- ✅ Get all registered tokens
- ✅ Read token config
- ✅ Validate fee margin bounds

#### PaymasterFactory Contract
- ✅ Get all deployments
- ✅ Read deployment details
- ✅ Verify three contracts deployed
- ✅ Validate unique addresses

#### LiquidityVault Contract
- ✅ Read LP position
- ✅ Validate vault token
- ✅ Track total ETH liquidity

#### NodeStakingManager Contract
- ✅ Read network stats
- ✅ Read operator stats
- ✅ Get operator nodes list
- ✅ Read node info
- ✅ Calculate pending rewards
- ✅ Get token distribution
- ✅ Get all network nodes

#### IdentityRegistry Contract
- ✅ Calculate required stake
- ✅ Get all registered agents
- ✅ Get agents by tag
- ✅ Read agent metadata
- ✅ Read agent tags
- ✅ Read stake info
- ✅ Verify agent ownership

### A2A Agent Tests (2 test files, ~15 tests)

#### Agent Discovery
- ✅ Serve agent card at well-known endpoint
- ✅ List all available skills
- ✅ Include capability metadata
- ✅ Specify transport preferences

#### JSON-RPC Communication
- ✅ Respond to message/send method
- ✅ Return error for unknown method
- ✅ Execute list-protocol-tokens skill
- ✅ Execute get-node-stats skill
- ✅ Execute list-nodes skill
- ✅ Execute list-registered-apps skill
- ✅ Execute get-app-by-tag skill
- ✅ Return error for unknown skill
- ✅ Handle missing params gracefully

#### Governance Agent
- ✅ Serve governance agent card
- ✅ List futarchy capabilities
- ✅ List governance skills
- ✅ Specify governance metadata

### Integration Tests (1 test file, ~4 tests)
- ✅ Full token lifecycle
- ✅ Bridge → deploy → liquidity → earnings
- ✅ Node staking complete flow
- ✅ App registry complete flow

## Test Execution Flow

### Sequential Test Execution
Tests run sequentially (not parallel) because:
1. MetaMask state is shared
2. Blockchain state modifications affect subsequent tests
3. Wallet nonce must be managed

### Test Isolation
Each test:
1. Sets up fresh MetaMask state
2. Connects to Jeju localnet
3. Imports test account
4. Performs test actions
5. Cleans up after itself

## Debugging Tests

### View Test Report
```bash
bun playwright show-report
```

### Run Specific Test File
```bash
bun run test:e2e tests/e2e/01-wallet-connection.spec.ts
```

### Debug Mode (Headed Browser)
```bash
DEBUG=1 bun run test:e2e
```

### Screenshots and Videos
Failed tests automatically capture:
- Screenshots (in `test-results/`)
- Videos (in `test-results/`)
- Traces (in `test-results/`)

## Common Issues

### MetaMask Not Loading
- Ensure Playwright runs in non-headless mode
- Check synpress version compatibility
- Clear browser cache: `rm -rf playwright/.cache`

### Transaction Failures
- Verify localnet is running on port 9545
- Check wallet has sufficient ETH
- Confirm contracts are deployed

### A2A Server Not Responding
- Ensure server running on port 4003
- Check CORS configuration
- Verify agent card JSON is valid

## Continuous Integration

Add to CI pipeline:

```yaml
- name: Install dependencies
  run: cd apps/gateway && bun install

- name: Install Playwright browsers
  run: cd apps/gateway && bunx playwright install chromium

- name: Run contract tests
  run: cd apps/gateway && bun run test:contracts

- name: Start test environment
  run: |
    bun run dev &
    sleep 10

- name: Run E2E tests
  run: cd apps/gateway && bun run test:e2e

- name: Upload test artifacts
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: playwright-report
    path: apps/gateway/playwright-report/
```

## Test Data

### Test Wallets
- **Account 0**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Primary test wallet)
- **Account 1**: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Secondary for multi-user tests)

### Test Tokens
- **elizaOS**: Native Jeju token ($0.10)
- **CLANKER**: Bridged from Base ($26.14)
- **VIRTUAL**: Bridged from Base ($1.85)
- **CLANKERMON**: Bridged from Base ($0.15)

### Contract Addresses
Loaded from `.env.local` after deployment

## Best Practices

1. **Wait for transactions**: Use `waitForTransactionReceipt` in contract tests
2. **Check visibility first**: Use `.isVisible().catch(() => false)` for conditional elements
3. **Clear test data**: Reset state between test runs if needed
4. **Test real flows**: Avoid mocking contract calls in E2E tests
5. **Validate UI state**: Check both successful and error states

## Extending Tests

To add new tests:

1. **New UX Flow**: Add to `tests/e2e/`
2. **New Contract**: Add to `tests/contracts/`
3. **New A2A Skill**: Add to `tests/a2a/`
4. **Update fixtures**: Extend `wallet.ts` or `contracts.ts` as needed

## Performance

Target execution times:
- Unit tests: < 5s
- Contract tests: < 30s
- E2E tests: < 5min
- Full suite: < 10min

## Coverage Goals

- **E2E**: 100% of user-facing flows
- **Contracts**: 100% of public functions
- **A2A**: 100% of agent skills
- **Integration**: All critical paths


