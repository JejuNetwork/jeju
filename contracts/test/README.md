# Contest Oracle Test Suite

Comprehensive tests for TEE-based contest oracle system.

## Test Coverage

### Contest.t.sol (32 tests) ✅

**Core Functionality:**
- ✅ Deployment and configuration
- ✅ TEE publisher authorization
- ✅ Container hash approval system
- ✅ Contest announcement (PENDING state)
- ✅ Contest start (ACTIVE state) 
- ✅ Grace period (GRACE_PERIOD state)
- ✅ Result publication with TEE attestation (FINISHED state)

**State Machine:**
- ✅ State transitions enforced (PENDING → ACTIVE → GRACE_PERIOD → FINISHED)
- ✅ Can't skip states
- ✅ Grace period timing enforced (30s minimum)
- ✅ Invalid state transitions rejected

**TEE Attestation:**
- ✅ Attestation storage (containerHash, quote, signature, timestamp)
- ✅ Untrusted container hashes rejected
- ✅ Attestation verification via verifyCommitment()

**Oracle Interfaces:**
- ✅ IPredictionOracle implementation
  - getOutcome() - binary mapping
  - isWinner() - N/A for contests
  - verifyCommitment() - checks attestation
- ✅ IContestOracle implementation
  - getContestInfo() - state, mode, times, options
  - getOptions() - option names
  - getWinner() - winner index
  - getTop3() - top 3 rankings
  - isWinningOption() - check if option won

**Binary Outcome Mapping:**
- ✅ Options 0-1 → NO (false)
- ✅ Options 2-3 → YES (true)
- ✅ Works with even number of options (midpoint calculation)

**Ranking System:**
- ✅ Index 0 = Winner (1st place)
- ✅ Index 1 = 2nd place
- ✅ Index 2 = 3rd place
- ✅ Index N = (N+1)th place

**MarketFactory Compatibility:**
- ✅ games() function returns expected struct
- ✅ startTime field populated
- ✅ Question generation from options
- ✅ Works with MarketFactory.createMarketFromOracle()

### ContestIntegration.t.sol (4 tests) ✅

**Full Integration:**
- ✅ Complete contest lifecycle with betting
  - Announce → Start → Bet → Grace → Results → Resolve → Payout
- ✅ Multiple races with different winners
- ✅ MarketFactory auto-creation from Contest events
- ✅ Grace period MEV protection

**Betting Flow:**
- ✅ Traders can bet on outcomes
- ✅ Winners receive payouts
- ✅ Losers cannot claim
- ✅ Market resolution based on Contest oracle

**Components Tested:**
- ✅ Contest.sol (oracle)
- ✅ Predimarket.sol (market)
- ✅ MarketFactory.sol (automation)
- ✅ ERC20 token (payment)

## Running Tests

### All Contest Tests
```bash
cd contracts
forge test --match-contract Contest -vv
```

### Specific Test File
```bash
forge test --match-contract ContestTest
forge test --match-contract ContestIntegrationTest
```

### With Gas Reports
```bash
forge test --match-contract Contest --gas-report
```

## Test Results

```
Contract: Contest.t.sol
✅ 32/32 tests passing

Contract: ContestIntegration.t.sol  
✅ 4/4 tests passing

Total: 36/36 tests passing ✅
```

## What's Tested

### ✅ Covered
- Contest lifecycle (all states)
- TEE attestation system
- Grace period enforcement
- State machine transitions
- Binary outcome mapping
- Ranking system (0=winner)
- IPredictionOracle interface
- IContestOracle interface
- Integration with Predimarket
- Integration with MarketFactory
- Multi-trader scenarios
- Winner/loser payouts

### 🔜 Future Tests Needed
- [ ] ERC-8004 registry integration
- [ ] Real TEE attestation verification (SGX/SEV-SNP)
- [ ] Multi-option markets (when implemented)
- [ ] TOP_THREE contest mode
- [ ] FULL_RANKING contest mode
- [ ] Cross-chain oracle integration
- [ ] E2E tests with agents
- [ ] Load testing (many concurrent contests)

## Architecture Being Tested

```
TEE Container (Off-Chain)
    ↓ announces with options
Contest.sol (On-Chain Oracle)
    ↓ implements IPredictionOracle
Predimarket.sol (Prediction Market)
    ← created by ←
MarketFactory.sol (Automation)
```

## Key Test Scenarios

### 1. Happy Path
1. TEE announces contest
2. Contest starts, trading opens
3. Traders bet
4. Grace period starts, trading freezes
5. TEE publishes results with attestation
6. Market resolves
7. Winners claim payouts

### 2. MEV Protection
1. Grace period prevents early result publication
2. Must wait full 30 seconds
3. No front-running possible

### 3. Security
1. Only approved containers accepted
2. Only TEE publisher can announce/start/publish
3. Invalid winners rejected
4. State machine enforced

## Test Data

**Horses:**
- Index 0: Thunder
- Index 1: Lightning
- Index 2: Storm
- Index 3: Blaze

**Timing:**
- Announcement → Start: 30s
- Trading duration: 60s
- Grace period: 30s
- Total cycle: ~120s

**Default Winner:**
- Storm (index 2)
- Maps to YES in binary markets

## Notes

- All tests use mock TEE attestation
- Real TEE verification would use SGX/SEV-SNP SDKs
- Grace period timing is critical for MEV protection
- Rankings always 0-indexed (0=winner)

