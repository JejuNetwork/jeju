# Jeju Network Leaderboard Payment Integration Plan

## Overview

This document outlines the complete plan to integrate payment distribution into the Jeju Network leaderboard system.

### Two Core Features:

1. **Protocol Fee Distribution**: 10% of protocol fees automatically distributed monthly to contributors based on their leaderboard scores
2. **Community Airdrops**: Allow anyone to airdrop tokens to contributors based on weighted scoring (all-time, 6-month, 1-month average)

## Current System Analysis

### Existing Infrastructure

#### Leaderboard (`apps/leaderboard/`)
- ✅ SQLite database with contributor scores (`userDailyScores`)
- ✅ Scoring system calculating points for PRs, issues, reviews, comments
- ✅ Wallet address linking (`walletAddresses` table)
- ✅ Daily, weekly, monthly, all-time scoring periods
- ✅ Tag-based expertise tracking
- ✅ GitHub integration for data ingestion

#### Smart Contracts (`contracts/`)
- ✅ `FeeDistributor.sol` - Distributes fees: 50% to apps, 50% to LPs
- ✅ `LiquidityPaymaster.sol` - Collects protocol fees from gas payments  
- ✅ `LiquidityVault.sol` - Manages LP rewards
- ✅ Token infrastructure (elizaOS, HG, USDC)
- ✅ Multi-token payment support

### Integration Points

1. **Fee Flow**: Paymaster → FeeDistributor → (Apps 50% | LPs 50%)
2. **Proposed New Flow**: Paymaster → FeeDistributor → (Apps 45% | LPs 45% | Contributors 10%)
3. **Wallet Linking**: Contributors already have wallet addresses in leaderboard DB
4. **Score Calculation**: Daily scores aggregated into periods (weekly, monthly, all-time)

## Architecture Design

### Contract Architecture

```
                           ┌─────────────────────┐
                           │  LiquidityPaymaster │
                           │  (Collects Fees)    │
                           └──────────┬──────────┘
                                      │
                                      │ 100% of protocol fees
                                      │
                           ┌──────────▼──────────┐
                           │   FeeDistributor    │
                           │  (Modified)         │
                           └─────────┬───────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
                  │ 45%             │ 45%             │ 10%
                  │                  │                  │
         ┌────────▼────────┐ ┌──────▼──────┐  ┌──────▼─────────────┐
         │  App Developers  │ │  LP Vault   │  │  ContributorVault  │
         │  (Claimable)     │ │  (Auto Dist)│  │  (New Contract)    │
         └──────────────────┘ └─────────────┘  └────────┬───────────┘
                                                         │
                                                         │ Monthly Snapshots
                                                         │
                                                ┌────────▼──────────┐
                                                │  ScoreOracle      │
                                                │  (Off-chain →     │
                                                │   On-chain)       │
                                                └────────┬──────────┘
                                                         │
                                                         │ Weighted Scores
                                                         │
                                                ┌────────▼──────────┐
                                                │  Contributors     │
                                                │  (Claim Rewards)  │
                                                └───────────────────┘
```

### Data Flow

1. **Off-Chain** (Leaderboard):
   - GitHub data ingested daily
   - Scores calculated and stored in SQLite
   - Wallet addresses linked to contributors
   - Monthly snapshots prepared

2. **On-Chain** (Smart Contracts):
   - Protocol fees collected automatically
   - 10% allocated to ContributorVault
   - Oracle submits monthly contributor snapshots
   - Contributors claim their allocated rewards

## Implementation Plan

### Phase 1: Smart Contracts (Blockchain)

#### 1.1 Create ContributorVault.sol
**Purpose**: Manage and distribute protocol fees to contributors based on leaderboard scores

**Key Features**:
- Receive 10% of protocol fees from FeeDistributor
- Store monthly distribution snapshots
- Calculate pro-rata shares based on contributor scores
- Handle multi-token rewards (elizaOS, HG, USDC)
- Allow contributors to claim rewards
- Emergency pause/admin functions

**Functions**:
```solidity
- receiveMonthlyFees(uint256 amount, address token)
- submitMonthlySnapshot(bytes32 snapshotId, address[] contributors, uint256[] scores)
- claimRewards(bytes32 snapshotId, address token)
- getClaimableRewards(address contributor, bytes32 snapshotId, address token)
- emergencyWithdraw(address token, uint256 amount)
```

#### 1.2 Create ScoreOracle.sol
**Purpose**: Bridge off-chain leaderboard scores to on-chain contracts

**Key Features**:
- Authorized oracle address (bot/multisig)
- Submit monthly contributor snapshots
- Cryptographic proof of scores (optional Merkle root)
- Dispute mechanism (timelock before finalization)
- Historical snapshot storage

**Functions**:
```solidity
- submitSnapshot(bytes32 snapshotId, bytes32 merkleRoot, string ipfsHash)
- finalizeSnapshot(bytes32 snapshotId)
- disputeSnapshot(bytes32 snapshotId, string reason)
- getSnapshot(bytes32 snapshotId) returns (SnapshotData)
```

#### 1.3 Modify FeeDistributor.sol
**Purpose**: Split fees 3 ways instead of 2

**Changes**:
- Update fee splits: `APP_SHARE = 4500` (45%), `LP_SHARE = 4500` (45%), `CONTRIBUTOR_SHARE = 1000` (10%)
- Add `ContributorVault` address
- Route 10% of fees to ContributorVault in `distributeFees()`
- Emit new event: `ContributorFeesAllocated`

#### 1.4 Create AirdropManager.sol
**Purpose**: Allow anyone to airdrop tokens to contributors

**Key Features**:
- Accept any ERC20 token
- Use weighted scoring: 50% all-time, 30% 6-month, 20% 1-month
- Calculate pro-rata distribution
- Allow batch claims to save gas
- Track airdrop history
- Optional minimum contribution threshold

**Functions**:
```solidity
- createAirdrop(address token, uint256 amount, bytes32 snapshotId)
- claimAirdrop(uint256 airdropId)
- claimMultipleAirdrops(uint256[] airdropIds)
- getClaimableAirdrops(address contributor) returns (uint256[])
- getAirdropDetails(uint256 airdropId)
```

### Phase 2: Off-Chain Services (Leaderboard Backend)

#### 2.1 Extend Database Schema
Add new tables:

```sql
-- Monthly snapshots for on-chain submission
CREATE TABLE contributor_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  submitted_to_chain INTEGER DEFAULT 0,
  tx_hash TEXT,
  merkle_root TEXT
);

-- Contributor allocations per snapshot
CREATE TABLE contributor_allocations (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  username TEXT NOT NULL,
  wallet_address TEXT,
  score REAL NOT NULL,
  percentage REAL NOT NULL,
  rank INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES contributor_snapshots(snapshot_id),
  FOREIGN KEY (username) REFERENCES users(username)
);

-- Airdrop tracking
CREATE TABLE airdrops (
  airdrop_id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  total_amount TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  claimed_count INTEGER DEFAULT 0,
  total_contributors INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES contributor_snapshots(snapshot_id)
);

-- Individual airdrop claims
CREATE TABLE airdrop_claims (
  id TEXT PRIMARY KEY,
  airdrop_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  claimed INTEGER DEFAULT 0,
  claimed_at TEXT,
  tx_hash TEXT,
  FOREIGN KEY (airdrop_id) REFERENCES airdrops(airdrop_id),
  FOREIGN KEY (username) REFERENCES users(username)
);
```

#### 2.2 Create Snapshot Generation Service
**Location**: `apps/leaderboard/src/lib/blockchain/snapshotGenerator.ts`

**Responsibilities**:
- Run monthly (cron job)
- Calculate weighted scores (all-time, 6mo, 1mo)
- Generate contributor list with scores
- Create Merkle tree for on-chain verification
- Store snapshot in database
- Upload metadata to IPFS (optional)
- Prepare for oracle submission

#### 2.3 Create Oracle Bot Service
**Location**: `apps/leaderboard/src/lib/blockchain/oracleBot.ts`

**Responsibilities**:
- Monitor for new snapshots
- Submit snapshots to ScoreOracle contract
- Wait for dispute period
- Finalize snapshots
- Submit to ContributorVault
- Handle reorgs and retries

#### 2.4 Create Claim API
**Location**: `apps/leaderboard/src/app/api/claims/`

**Endpoints**:
- `GET /api/claims/:address` - Get claimable rewards for wallet
- `GET /api/claims/history/:address` - Get claim history
- `GET /api/airdrops` - List all airdrops
- `GET /api/airdrops/:id` - Get airdrop details
- `POST /api/airdrops/create` - Create new airdrop (proxies to contract)

### Phase 3: Frontend Integration

#### 3.1 Add "Rewards" Page
**Location**: `apps/leaderboard/src/app/rewards/page.tsx`

**Components**:
- **Claimable Rewards Card**:
  - Show total claimable amount per token
  - "Claim All" button
  - Individual claim buttons
  - Transaction status
  
- **Claim History Table**:
  - Date, amount, token, tx hash
  - Filter by token/date range
  
- **Next Distribution Countdown**:
  - Days until next snapshot
  - Current month's estimated allocation

#### 3.2 Add "Create Airdrop" Feature
**Location**: `apps/leaderboard/src/app/airdrops/create/page.tsx`

**UI Flow**:
1. Connect wallet
2. Select token (dropdown of approved tokens)
3. Enter amount
4. Preview distribution (top 10 recipients)
5. Confirm and submit transaction
6. Success page with airdrop ID

#### 3.3 Update Leaderboard Page
**Location**: `apps/leaderboard/src/app/leaderboard/page.tsx`

**New Features**:
- Add "Estimated Monthly Reward" column (based on current period)
- Show total reward pool size
- Link to rewards page
- Badge for top earners

#### 3.4 Add Wallet Connection
**Library**: `viem` + `wagmi` (already in package.json)

**Components**:
- ConnectWallet button in navigation
- Wallet display with address/ENS
- Network switcher (Jeju Network)
- Disconnect option

### Phase 4: Integration Scripts

#### 4.1 Monthly Distribution Script
**Location**: `scripts/leaderboard/monthly-distribution.ts`

**Workflow**:
```typescript
1. Calculate month-end snapshot
2. Generate Merkle tree
3. Submit to ScoreOracle
4. Wait for dispute period (24-48 hours)
5. Finalize snapshot
6. Notify contributors (optional email/discord)
```

#### 4.2 Airdrop Monitor
**Location**: `scripts/leaderboard/airdrop-monitor.ts`

**Responsibilities**:
- Listen for new airdrop events
- Update database
- Send notifications
- Generate airdrop announcements

## Testing Strategy

### Unit Tests
- Smart contract functions
- Score calculation logic
- Merkle tree generation
- API endpoints

### Integration Tests
- Full distribution flow (testnet)
- Oracle submission → finalization → claims
- Airdrop creation → distribution → claims
- Multi-token scenarios

### End-to-End Tests
- Complete monthly cycle
- Multiple concurrent airdrops
- Edge cases (zero scores, equal scores, etc.)

## Security Considerations

### Smart Contracts
- [ ] Reentrancy guards on all state-changing functions
- [ ] Access control (Ownable/AccessControl)
- [ ] Pause mechanism for emergencies
- [ ] Integer overflow protection (Solidity 0.8+)
- [ ] External audit before mainnet deployment

### Oracle
- [ ] Multi-sig for oracle address
- [ ] Dispute mechanism (24-48 hour timelock)
- [ ] Cryptographic proof (Merkle tree)
- [ ] Rate limiting
- [ ] Off-chain backup of all snapshots

### API
- [ ] Rate limiting
- [ ] Input validation
- [ ] CORS configuration
- [ ] API key authentication (optional)

## Deployment Plan

### Testnet Phase
1. Deploy contracts to Jeju testnet
2. Run 3 test distribution cycles
3. Test with 10-20 real contributors
4. Iterate based on feedback

### Mainnet Phase
1. Security audit
2. Deploy contracts
3. Announce to community (7 days notice)
4. First distribution (January 2026)
5. Monitor and optimize

## Success Metrics

- **Protocol Fee Share**: Track 10% allocation accuracy
- **Claim Rate**: % of contributors claiming rewards
- **Gas Efficiency**: Average gas cost per claim
- **Airdrop Adoption**: Number of community airdrops created
- **Contributor Growth**: New contributors attracted by rewards

## Timeline

- **Week 1-2**: Smart contract development
- **Week 3**: Smart contract testing & audit prep
- **Week 4-5**: Off-chain services & database
- **Week 6-7**: Frontend integration
- **Week 8**: Integration testing
- **Week 9**: Testnet deployment
- **Week 10**: Bug fixes & optimization
- **Week 11**: Security audit
- **Week 12**: Mainnet deployment

**Total**: ~3 months to production

## Open Questions

1. **Dispute Mechanism**: How long should the dispute period be?
2. **Minimum Threshold**: Should there be a minimum score to receive rewards?
3. **Token Support**: Which tokens should be supported initially?
4. **Oracle Authority**: Who should control the oracle address? (Multisig recommended)
5. **Historical Distributions**: Should we backpay contributors from before the system launch?

## Next Steps

1. Review and approve this plan
2. Prioritize TODOs
3. Assign ownership of each component
4. Set up testnet environment
5. Begin smart contract development


