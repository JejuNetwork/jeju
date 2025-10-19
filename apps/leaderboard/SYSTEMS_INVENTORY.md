# Complete Systems Inventory - Jeju Network Leaderboard Payment Integration

## 🏗️ **ALL SYSTEMS, FEATURES, CAPABILITIES & INTEGRATIONS**

### **SYSTEM 1: Smart Contract - FeeDistributorV2**
**Location**: `contracts/src/distributor/FeeDistributorV2.sol`  
**Lines**: 380  
**Purpose**: Distribute protocol fees 45%/45%/10% (apps/LPs/contributors)

**Features**:
- Monthly period management
- Snapshot submission (oracle only)
- Snapshot finalization
- Pro-rata reward calculation
- Single period claiming
- Batch period claiming
- Contributor pool balance tracking
- Period advancement
- Backward compatibility with V1

**Capabilities**:
- Store unlimited monthly snapshots
- Handle variable contributor counts
- Gas-efficient per-share accounting
- Pausable for emergencies
- Owner-controlled oracle address

**Integrations**:
- LiquidityVault (existing)
- Paymaster (existing)
- AirdropManager (new)
- Oracle Bot (new)

**Security**:
- ReentrancyGuard
- Ownable
- Pausable
- Pull payment pattern

---

### **SYSTEM 2: Smart Contract - AirdropManager**
**Location**: `contracts/src/distributor/AirdropManager.sol`  
**Lines**: 280  
**Purpose**: Enable community token airdrops to contributors

**Features**:
- Create airdrop with any ERC20
- Read snapshots from FeeDistributor
- Pro-rata distribution
- Single airdrop claiming
- Batch airdrop claiming
- Creator cancellation (after 30 days)
- Minimum airdrop amount enforcement
- Maximum contributor limit (500)

**Capabilities**:
- Support unlimited airdrops
- Multi-token support
- Gas-efficient batch claims
- Pagination support
- Query claimable airdrops

**Integrations**:
- FeeDistributorV2 (reads snapshots)
- Any ERC20 token
- Leaderboard database (off-chain)

**Security**:
- ReentrancyGuard
- Ownable
- Pausable
- Snapshot finalization check

---

### **SYSTEM 3: Database Schema**
**Location**: `apps/leaderboard/src/lib/data/schema.ts`  
**Migration**: `drizzle/0013_thin_ultimatum.sql`  
**Purpose**: Store contributor snapshots and airdrop data

**Tables** (4 new):
1. `contributor_snapshots` - Monthly snapshots
2. `contributor_allocations` - Individual allocations
3. `airdrops` - Airdrop metadata
4. `airdrop_claims` - Claim tracking

**Features**:
- Foreign key relationships
- Cascade deletes
- Optimized indexes
- Unique constraints
- Timestamp tracking

**Capabilities**:
- Store unlimited snapshots
- Track all allocations
- Monitor airdrops
- Query by multiple criteria

**Integrations**:
- Existing users table
- Existing walletAddresses table
- Drizzle ORM
- SQLite database

---

### **SYSTEM 4: Score Weighting Service**
**Location**: `apps/leaderboard/src/lib/blockchain/scoreWeighting.ts`  
**Lines**: 170  
**Purpose**: Calculate weighted contributor scores

**Features**:
- All-time score calculation
- 6-month score calculation
- 1-month score calculation
- Weighted combination (50/30/20)
- Ranking assignment
- Share conversion (BigInt precision)

**Capabilities**:
- Query all contributors
- Filter by date range
- Convert scores to pro-rata shares
- Batch wallet address resolution
- Statistics calculation

**Integrations**:
- userDailyScores table
- walletAddresses table
- date-utils library
- Drizzle ORM

**Data Structures**:
- ContributorScore interface
- BigInt shares calculation

---

### **SYSTEM 5: Snapshot Generator**
**Location**: `apps/leaderboard/src/lib/blockchain/snapshotGenerator.ts`  
**Lines**: 220  
**Purpose**: Generate monthly contributor snapshots

**Features**:
- Period boundary calculation
- Weighted score calculation
- Wallet filtering (contributors must have wallets)
- Database storage
- Statistics logging
- Snapshot retrieval
- Submission tracking
- Finalization tracking

**Capabilities**:
- Generate snapshot for any period
- Filter invalid wallets
- Calculate estimated rewards
- Store in database
- Mark as submitted/finalized

**Integrations**:
- scoreWeighting service
- contributor_snapshots table
- contributor_allocations table
- date-utils library

**Data Structures**:
- SnapshotData interface

---

### **SYSTEM 6: Blockchain Contract Client**
**Location**: `apps/leaderboard/src/lib/blockchain/contractClient.ts`  
**Lines**: 200  
**Purpose**: Interface with smart contracts via viem

**Features**:
- Public client (read operations)
- Wallet client (write operations)
- FeeDistributorV2 read functions (6)
- FeeDistributorV2 write functions (2)
- AirdropManager read functions (2)
- Transaction waiting
- Block number querying
- Gas estimation

**Capabilities**:
- Read contributor pool balance
- Read snapshot data
- Submit monthly snapshot
- Finalize snapshot
- Read airdrop data
- Check claimable amounts
- Wait for confirmations

**Integrations**:
- viem library
- FeeDistributorV2 contract
- AirdropManager contract
- Environment configuration

**Data Structures**:
- BlockchainConfig interface
- Contract ABIs (simplified)

---

### **SYSTEM 7: Oracle Bot**
**Location**: `apps/leaderboard/src/lib/blockchain/oracleBot.ts`  
**Lines**: 200  
**Purpose**: Automated snapshot submission to blockchain

**Features**:
- Continuous monitoring loop
- Snapshot submission
- Dispute period waiting (48h)
- Snapshot finalization
- Exponential backoff retry (3 attempts)
- Manual override functions
- Configurable parameters

**Capabilities**:
- Run as daemon
- Check every N minutes
- Auto-submit new snapshots
- Auto-finalize after dispute period
- Handle transaction failures
- Log all operations

**Integrations**:
- contractClient
- snapshotGenerator
- FeeDistributorV2 contract

**Data Structures**:
- OracleBotConfig interface

---

### **SYSTEM 8: API - Snapshots**
**Location**: `apps/leaderboard/src/app/api/snapshots/latest/route.ts`  
**Purpose**: Serve latest snapshot data

**Features**:
- Get latest snapshot from DB
- Return top 10 contributors
- Calculate percentages
- Format BigInt to string

**Capabilities**:
- RESTful GET endpoint
- JSON response
- Error handling (404)

**Integrations**:
- snapshotGenerator
- Next.js API routes

---

### **SYSTEM 9: API - Claims**
**Locations**: 
- `apps/leaderboard/src/app/api/claims/[address]/route.ts`
- `apps/leaderboard/src/app/api/claims/history/[address]/route.ts`

**Purpose**: Query claimable rewards and claim history

**Features**:
- Address validation (isAddress)
- Read from blockchain
- Read from database
- Calculate total claimable
- Format responses

**Capabilities**:
- Check last 12 periods
- Return unclaimed periods
- Historical allocations
- BigInt to string conversion

**Integrations**:
- contractClient
- contributor_allocations table
- viem (address validation)

---

### **SYSTEM 10: API - Airdrops**
**Locations**:
- `apps/leaderboard/src/app/api/airdrops/route.ts`
- `apps/leaderboard/src/app/api/airdrops/[id]/route.ts`

**Purpose**: Query airdrop data

**Features**:
- Pagination support
- Detailed airdrop info
- Recent claims display
- Percentage calculations

**Capabilities**:
- List all airdrops
- Filter and sort
- Get airdrop details
- Track claim progress

**Integrations**:
- airdrops table
- airdrop_claims table
- Drizzle ORM

---

### **SYSTEM 11: API - Rewards Estimation**
**Location**: `apps/leaderboard/src/app/api/rewards/estimate/[address]/route.ts`  
**Purpose**: Estimate next month's rewards

**Features**:
- Current score calculation
- Pool balance reading
- Pro-rata estimation
- Contributor lookup by wallet

**Capabilities**:
- Real-time estimates
- Percentage calculation
- Score breakdown

**Integrations**:
- scoreWeighting service
- contractClient
- walletAddresses table

---

### **SYSTEM 12: Frontend - Rewards Page**
**Location**: `apps/leaderboard/src/app/rewards/page.tsx`  
**Lines**: 190  
**Purpose**: User interface for claiming rewards

**Features**:
- Wallet connection
- Claimable rewards display
- Claim history table
- Distribution countdown
- How-it-works info
- Transaction toasts
- Loading states

**Capabilities**:
- Connect/disconnect wallet
- Fetch claims via API
- Fetch history via API
- Claim single period (mock)
- Claim multiple periods (mock)
- Auto-refresh after claim

**Integrations**:
- ClaimableRewardsCard component
- ClaimHistoryTable component
- NextDistributionCountdown component
- API endpoints
- Toast notifications (sonner)

---

### **SYSTEM 13: Component - ClaimableRewardsCard**
**Location**: `apps/leaderboard/src/components/rewards/ClaimableRewardsCard.tsx`  
**Lines**: 140  
**Purpose**: Display and claim rewards

**Features**:
- Total claimable display
- Period breakdown
- Individual claim buttons
- Claim all button
- Loading skeletons
- Empty state
- Explorer link

**Capabilities**:
- Format large numbers
- Handle multiple periods
- Disable during claiming
- Show claimed status

**Integrations**:
- Card UI components
- Button component
- formatNumber utility

---

### **SYSTEM 14: Component - ClaimHistoryTable**
**Location**: `apps/leaderboard/src/components/rewards/ClaimHistoryTable.tsx`  
**Lines**: 110  
**Purpose**: Display allocation history

**Features**:
- Tabular data display
- Period info
- Score display
- Rank display
- Share percentage
- Status badges
- Explorer links

**Capabilities**:
- Format dates
- Format numbers
- Show submission status
- Link to block explorer

**Integrations**:
- Card UI components
- date-utils library
- formatNumber utility

---

### **SYSTEM 15: Component - NextDistributionCountdown**
**Location**: `apps/leaderboard/src/components/rewards/NextDistributionCountdown.tsx`  
**Lines**: 50  
**Purpose**: Show countdown to next distribution

**Features**:
- Real-time countdown
- Timeline display
- Auto-update every minute

**Capabilities**:
- Calculate time until month-end
- Format as days/hours/minutes
- Update automatically

**Integrations**:
- Card UI components
- React useEffect

---

### **SYSTEM 16: Script - Monthly Distribution**
**Location**: `scripts/leaderboard/monthly-distribution.ts`  
**Lines**: 120  
**Purpose**: CLI for generating and submitting snapshots

**Features**:
- Dry-run mode
- Pool balance reading
- Snapshot generation
- Top 10 display
- Blockchain submission
- Transaction confirmation
- Next steps guidance

**Capabilities**:
- Run manually or automated
- Show detailed output
- Colored terminal output
- Error handling

**Integrations**:
- snapshotGenerator
- contractClient
- Commander CLI
- Chalk (colors)

---

### **SYSTEM 17: Script - Airdrop Monitor**
**Location**: `scripts/leaderboard/airdrop-monitor.ts`  
**Lines**: 110  
**Purpose**: Monitor blockchain for airdrop events

**Features**:
- Event filtering
- AirdropCreated listener
- AirdropClaimed listener
- Daemon mode
- Once mode

**Capabilities**:
- Poll every 30 seconds
- Process new events
- Update database (TODO)
- Log all events

**Integrations**:
- viem event filters
- AirdropManager contract
- Database (TODO)

---

### **SYSTEM 18: Script - Snapshot Verifier**
**Location**: `scripts/leaderboard/verify-snapshot.ts`  
**Lines**: 120  
**Purpose**: Validate snapshot before submission

**Features**:
- Wallet address validation
- Share sum verification
- Zero share detection
- Distribution fairness check
- Database consistency check
- Error/warning reporting

**Capabilities**:
- Verify all checks
- Exit with status code
- Colored output
- Detailed error messages

**Integrations**:
- snapshotGenerator
- Database queries
- Chalk (colors)

---

## 🔗 **SHARED DEPENDENCIES**

### Libraries:
- viem (blockchain)
- drizzle-orm (database)
- date-fns (dates)
- next.js (frontend/API)
- commander (CLI)
- chalk (terminal colors)
- sonner (toasts)

### Shared Types (Potential Duplication):
- Address (from viem)
- BigInt (native)
- ContributorScore
- SnapshotData
- Date/timestamp formats

### Shared Utilities:
- formatNumber
- toDateString
- isAddress
- BigInt conversions

---

## ⚠️ **POTENTIAL ISSUES TO INVESTIGATE**

1. **Duplicate type definitions** across files
2. **Error handling** may be defensive (should be fail-fast)
3. **Mock wallet** in rewards page (not real wagmi)
4. **TODO comments** in airdrop-monitor.ts
5. **Contract ABIs** are simplified (need full ABIs)
6. **currentPeriod** hardcoded in one API
7. **No actual tests run yet** (only written)
8. **No integration between systems tested**
9. **Type assertions** in contractClient
10. **Potential null/undefined handling** (defensive)

---

## 📋 **SYSTEMS COUNT**

- **Smart Contracts**: 2
- **Database Tables**: 4 new + 1 extended
- **Backend Services**: 4
- **API Endpoints**: 6
- **Frontend Components**: 4
- **Automation Scripts**: 3
- **Deployment Scripts**: 2
- **Test Files**: 2

**Total Systems**: 18 interconnected systems


