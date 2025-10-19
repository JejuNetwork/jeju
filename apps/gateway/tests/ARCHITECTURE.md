# Gateway Portal - Test Architecture

## Overview

The Gateway Portal test suite is designed with comprehensive coverage across all layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    Gateway Portal Frontend                   │
│              (React + Viem + Wagmi + RainbowKit)            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐   ┌────────▼────────┐   ┌───────▼────────┐
│   E2E Tests    │   │  Contract Tests │   │   A2A Tests    │
│   (Playwright) │   │     (Bun)       │   │     (Bun)      │
│   + Synpress   │   │   + Viem        │   │   + Fetch      │
└────────────────┘   └─────────────────┘   └────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌────────────────┐   ┌─────────────────┐   ┌────────────────┐
│  MetaMask      │   │  Smart          │   │  A2A Server    │
│  Automation    │   │  Contracts      │   │  (Express)     │
└────────────────┘   └─────────────────┘   └────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                   ┌──────────▼──────────┐
                   │  Jeju Localnet       │
                   │  (Anvil/Kurtosis)   │
                   └─────────────────────┘
```

## Test Layers

### Layer 1: Unit Tests
**Technology**: Bun Test Runner  
**Purpose**: Fast validation of business logic  
**No Dependencies**: Can run without servers or blockchain

**Files**: `src/lib/tests/*.test.ts`

**Validates**:
- Token configurations
- Utility functions
- Data transformations
- Type safety

**Execution**: < 1 second

### Layer 2: Contract Tests
**Technology**: Bun + Viem  
**Purpose**: Direct smart contract interaction  
**Dependencies**: Localnet running

**Files**: `tests/contracts/*.test.ts`

**Validates**:
- Contract state reads
- Parameter validation
- Return value correctness
- Cross-contract relationships

**Execution**: ~30 seconds

### Layer 3: A2A Agent Tests
**Technology**: Bun + Fetch API  
**Purpose**: Agent protocol compliance  
**Dependencies**: A2A server running

**Files**: `tests/a2a/*.test.ts`

**Validates**:
- Agent card structure
- JSON-RPC protocol
- Skill execution
- Error handling
- Message format

**Execution**: ~10 seconds

### Layer 4: E2E Tests
**Technology**: Playwright + Synpress  
**Purpose**: Full user journey automation  
**Dependencies**: All servers + contracts deployed

**Files**: `tests/e2e/*.spec.ts`

**Validates**:
- User workflows
- UI interactions
- MetaMask transactions
- Error states
- Success feedback
- Multi-token equality

**Execution**: ~5 minutes

### Layer 5: Integration Tests
**Technology**: Playwright + Synpress  
**Purpose**: Complete end-to-end workflows  
**Dependencies**: All servers + contracts deployed

**Files**: `tests/integration/*.spec.ts`

**Validates**:
- Complete user journeys
- Multi-step workflows
- Cross-feature interactions
- Real-world scenarios

**Execution**: ~10 minutes

## Test Execution Strategy

### Development (Fast Feedback)
```bash
# Quick validation during development
bun run test:unit     # < 1s
bun run test:watch    # Auto-rerun on changes
```

### Pre-Commit (Medium Validation)
```bash
# Before committing code
bun test              # Unit + Contract + A2A (~40s)
```

### Pre-Deploy (Full Validation)
```bash
# Before deploying to testnet/mainnet
bun run test:all      # Everything (~10min)
```

### CI/CD (Automated)
```bash
# In GitHub Actions
bun run test:all
```

## Test Fixtures

### Wallet Fixture (`tests/fixtures/wallet.ts`)
Provides MetaMask automation utilities:

- `setupMetaMask()` - Configure network
- `importTestAccount()` - Import test wallet
- `connectWallet()` - Connect to dApp
- `TEST_WALLET` - Primary test account
- `SECOND_TEST_WALLET` - For multi-user scenarios

### Contract Fixture (`tests/fixtures/contracts.ts`)
Provides blockchain interaction utilities:

- `getPublicClient()` - Read-only client
- `getWalletClient()` - Transaction signing
- `getContractAddresses()` - Deployed addresses
- `fundAccount()` - Send test ETH

## Helper Modules

### Assertions (`tests/helpers/assertions.ts`)
Custom assertions for Gateway Portal:

- `assertAllProtocolTokens()` - Verify all 4 tokens
- `assertSuccessMessage()` - Check success feedback
- `assertErrorMessage()` - Check error feedback
- `selectToken()` - Interact with token selector
- `navigateToTab()` - Tab navigation

### Contract Helpers (`tests/helpers/contract-helpers.ts`)
Blockchain test utilities:

- `getTokenBalance()` - Query ERC20 balance
- `approveToken()` - Approve token spending
- `waitForTx()` - Wait for confirmation
- `isContract()` - Verify address is contract
- `mineBlocks()` - Advance blockchain time
- `snapshot()` / `revert()` - Test isolation

### A2A Helpers (`tests/helpers/a2a-helpers.ts`)
Agent protocol utilities:

- `createA2ARequest()` - Build JSON-RPC request
- `sendA2ARequest()` - Send to agent
- `executeSkill()` - Execute agent skill
- `fetchAgentCard()` - Get agent capabilities
- `extractResponseData()` - Parse response
- `validateSkillExecution()` - Verify skill works

## Test Data Management

### Test Wallets
Deterministic Anvil accounts:

```typescript
Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
  Initial Balance: 10000 ETH

Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
  Initial Balance: 10000 ETH
```

### Protocol Tokens (Test Config)
```typescript
elizaOS:     0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
CLANKER:     0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VIRTUAL:     0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
CLANKERMON:  0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
```

## CI/CD Pipeline

### GitHub Actions Workflow
```yaml
1. Setup environment
2. Install dependencies
3. Deploy contracts
4. Run unit tests
5. Run contract tests
6. Run A2A tests
7. Run E2E tests
8. Upload artifacts
```

### Test Artifacts
- Playwright HTML report
- Screenshots of failures
- Videos of test runs
- Execution traces
- Coverage reports

## Performance Monitoring

### Target Execution Times
| Test Type | Target | Actual |
|-----------|--------|--------|
| Unit | < 5s | ~11ms ✅ |
| Contract | < 30s | TBD |
| A2A | < 10s | TBD |
| E2E | < 5min | TBD |
| Integration | < 10min | TBD |
| **Total** | **< 15min** | **TBD** |

### Performance Optimization
- Parallel test execution where safe
- Shared wallet setup across tests
- Cached contract reads
- Optimized wait strategies

## Maintenance

### Adding New Tests
1. Determine appropriate layer (unit/contract/A2A/E2E)
2. Use corresponding template
3. Follow naming convention (`##-feature.spec.ts`)
4. Add to test checklist
5. Update documentation

### Updating Tests
When contracts change:
1. Update ABIs in `src/lib/contracts.ts`
2. Update test expectations
3. Run full test suite
4. Fix breaking tests
5. Commit with contract changes

### Test Review Process
1. All tests must pass before merge
2. New features require tests
3. Coverage should not decrease
4. Performance must meet targets
5. CI must be green

## Debugging Guide

### E2E Test Fails
1. Run with headed browser: `bun run test:e2e:headed`
2. Check screenshots in `test-results/`
3. Review video of failure
4. Inspect trace in Playwright UI
5. Verify selectors are correct

### Contract Test Fails
1. Check localnet is running: `curl http://localhost:9545`
2. Verify contracts deployed: `ls contracts/deployments/`
3. Check `.env.local` has addresses
4. Run single test: `bun test tests/contracts/file.test.ts`
5. Add console logs to debug

### A2A Test Fails
1. Check server is running: `curl http://localhost:4003/.well-known/agent-card.json`
2. Verify JSON-RPC format
3. Check skill implementation
4. Review server logs
5. Test endpoint manually with curl

## Security Considerations

### Test Isolation
- Tests use separate test wallets
- State resets between tests
- No production data touched
- Localnet only

### Sensitive Data
- No real private keys in tests
- Test data clearly marked
- Environment variables for config
- No credentials in code

## Future Enhancements

- [ ] Visual regression testing
- [ ] Performance benchmarking
- [ ] Load testing for A2A server
- [ ] Fuzz testing for contracts
- [ ] Security audit automation
- [ ] Gas usage tracking
- [ ] Cross-browser testing
- [ ] Mobile device testing

