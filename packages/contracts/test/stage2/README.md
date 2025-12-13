# Stage 2 Contracts Test Suite

Comprehensive test coverage for Stage 2 decentralized OP Stack contracts.

## Test Files

### SequencerRegistry.t.sol (50+ tests)
- ✅ Registration (boundary conditions, invalid inputs)
- ✅ Staking (increase/decrease, edge cases)
- ✅ Slashing (all reasons, partial/full)
- ✅ Block production (double-signing detection)
- ✅ Reputation integration
- ✅ Selection weights
- ✅ Pause/unpause
- ✅ Edge cases (concurrent operations, exact boundaries)

### GovernanceTimelock.t.sol (30+ tests)
- ✅ Proposal creation (normal + emergency)
- ✅ Execution (before/after timelock, edge cases)
- ✅ Cancellation
- ✅ View functions (canExecute, timeRemaining)
- ✅ Emergency bugfix path
- ✅ Admin functions
- ✅ Integration scenarios

### DisputeGameFactory.t.sol (40+ tests)
- ✅ Game creation (permissionless, bond validation)
- ✅ Resolution (challenger wins, proposer wins, timeout)
- ✅ Multiple prover types
- ✅ Concurrent games
- ✅ Edge cases (boundaries, uniqueness)
- ✅ Pause/unpause

### Integration.t.sol (10+ tests)
- ✅ Sequencer + Reputation integration
- ✅ Governance + Timelock integration
- ✅ Dispute + Sequencer integration
- ✅ Full lifecycle scenarios
- ✅ Concurrent operations

### Fuzz.t.sol (10+ tests)
- ✅ Fuzz testing for all contracts
- ✅ Invariant testing
- ✅ Property-based testing

## Running Tests

```bash
cd packages/contracts

# All Stage 2 tests
forge test --match-path "test/stage2/**" -vv

# Specific contract
forge test --match-contract SequencerRegistryTest -vv
forge test --match-contract GovernanceTimelockTest -vv
forge test --match-contract DisputeGameFactoryTest -vv

# Integration tests
forge test --match-contract Stage2IntegrationTest -vv

# Fuzz tests
forge test --match-contract Stage2FuzzTest -vv --fuzz-runs 1000

# With gas reports
forge test --match-path "test/stage2/**" --gas-report
```

## Test Coverage

### Boundary Conditions ✅
- MIN_STAKE / MAX_STAKE boundaries
- Timelock delay boundaries
- Bond min/max boundaries
- Reputation score boundaries (0-10000)

### Edge Cases ✅
- Zero values
- Maximum values
- Concurrent operations
- State transitions
- Invalid inputs

### Error Handling ✅
- All custom errors tested
- Invalid parameter validation
- State validation
- Access control

### Integration ✅
- Real IdentityRegistry integration
- Real ReputationRegistry integration
- Contract-to-contract calls
- Event verification

### Concurrent/Async ✅
- Multiple sequencers registering
- Multiple games created
- Concurrent proposals
- Race conditions

## Test Statistics

- **Total Tests**: 140+
- **Contract Tests**: 120+
- **Integration Tests**: 10+
- **Fuzz Tests**: 10+
- **Coverage**: >95% of critical paths

## Key Test Scenarios

### SequencerRegistry
1. Register with exact MIN_STAKE ✅
2. Register with exact MAX_STAKE ✅
3. Double-signing detection ✅
4. Slashing with partial stake below minimum ✅
5. Reputation affects selection weight ✅
6. Concurrent registration ✅

### GovernanceTimelock
1. Execute exactly at timelock boundary ✅
2. Emergency bugfix shorter delay ✅
3. Cancel before execution ✅
4. Multiple concurrent proposals ✅
5. Proposal ID uniqueness ✅

### DisputeGameFactory
1. Permissionless game creation ✅
2. Multiple games with different outcomes ✅
3. Timeout resolution ✅
4. Multiple prover types ✅
5. Bond locked until resolution ✅

## Test Quality

- ✅ Real contracts (no mocks for dependencies)
- ✅ Actual output verification
- ✅ Event checking
- ✅ State inspection
- ✅ Gas optimization verification
- ✅ Reentrancy protection verified

