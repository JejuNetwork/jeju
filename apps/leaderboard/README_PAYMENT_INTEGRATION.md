# Jeju Network Leaderboard - Payment Integration

## 🎯 Overview

This leaderboard now includes **automated payment distribution** to GitHub contributors!

### Features Added:
1. **10% Protocol Fee Distribution** - Monthly rewards based on contribution scores
2. **Community Airdrops** - Anyone can airdrop tokens to contributors
3. **Weighted Scoring** - 50% all-time + 30% 6-month + 20% 1-month

---

## 🏗️ Architecture

```
GitHub Contributions → Leaderboard Scores → Monthly Snapshots → Blockchain → Contributors Claim Rewards
```

### Components:
- **FeeDistributorV2.sol** - Distributes 45%/45%/10% (apps/LPs/contributors)
- **AirdropManager.sol** - Enables community token airdrops
- **Oracle Bot** - Submits monthly snapshots automatically
- **Rewards Dashboard** - UI for claiming rewards

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd apps/leaderboard
bun install
```

### 2. Run Database Migration
```bash
bun run db:migrate
```

### 3. Configure Environment
```bash
# Copy and edit .env
cp .env.example .env

# Add blockchain config:
JEJU_RPC_URL=http://localhost:9545
FEE_DISTRIBUTOR_ADDRESS=0x...
AIRDROP_MANAGER_ADDRESS=0x...
ORACLE_PRIVATE_KEY=0x...
```

### 4. Generate Test Snapshot
```bash
cd ../..
bun run scripts/leaderboard/monthly-distribution.ts --dry-run
```

### 5. Start Development Server
```bash
cd apps/leaderboard
bun run dev
# Visit http://localhost:3000/rewards
```

---

## 📊 Monthly Distribution Process

### Automated (Recommended):
```bash
# Run oracle bot as daemon
bun run scripts/leaderboard/oracle-bot.ts

# Bot will:
# 1. Check for end of month
# 2. Generate snapshot
# 3. Submit to blockchain
# 4. Wait 48h dispute period
# 5. Finalize snapshot
# 6. Contributors can claim!
```

### Manual:
```bash
# 1. Generate snapshot
bun run scripts/leaderboard/monthly-distribution.ts

# 2. Wait 48 hours

# 3. Finalize (oracle bot does this automatically)
# Or manually: call finalizeSnapshot(period) on contract
```

---

## 🎨 Frontend Usage

### For Contributors:
1. Connect wallet at `/rewards`
2. View claimable rewards
3. Click "Claim All" or claim individual periods
4. Sign transaction
5. Receive tokens!

### For Community (Airdrops):
1. Have ERC20 tokens
2. Approve AirdropManager contract
3. Call `createAirdrop(token, amount, period)`
4. Contributors can claim pro-rata
5. Creator can cancel after 30 days

---

## 📁 File Structure

```
apps/leaderboard/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── claims/[address]/route.ts       # Get claimable rewards
│   │   │   ├── claims/history/[address]/route.ts # Claim history
│   │   │   ├── airdrops/route.ts               # List airdrops
│   │   │   ├── airdrops/[id]/route.ts          # Airdrop details
│   │   │   ├── snapshots/latest/route.ts       # Latest snapshot
│   │   │   └── rewards/estimate/[address]/route.ts # Estimate rewards
│   │   └── rewards/
│   │       └── page.tsx                        # Rewards dashboard
│   ├── components/
│   │   └── rewards/
│   │       ├── ClaimableRewardsCard.tsx        # Claim interface
│   │       ├── ClaimHistoryTable.tsx           # History table
│   │       └── NextDistributionCountdown.tsx   # Countdown timer
│   └── lib/
│       └── blockchain/
│           ├── scoreWeighting.ts               # Weighted scoring logic
│           ├── snapshotGenerator.ts            # Monthly snapshot creation
│           ├── contractClient.ts               # Blockchain client (viem)
│           └── oracleBot.ts                    # Automated oracle bot
│
contracts/src/distributor/
├── FeeDistributorV2.sol                        # Fee distribution (45/45/10)
└── AirdropManager.sol                          # Community airdrops

scripts/leaderboard/
├── monthly-distribution.ts                     # Generate & submit snapshot
├── airdrop-monitor.ts                          # Monitor airdrop events
└── verify-snapshot.ts                          # Verify before submission
```

---

## 🔧 Configuration

### Environment Variables:
```bash
# Existing (for leaderboard)
GITHUB_TOKEN=your_github_token
OPENROUTER_API_KEY=your_openrouter_key

# NEW (for payment integration)
JEJU_RPC_URL=http://localhost:9545
CHAIN_ID=31337
FEE_DISTRIBUTOR_ADDRESS=0x...
AIRDROP_MANAGER_ADDRESS=0x...
ORACLE_PRIVATE_KEY=0x...
DISPUTE_PERIOD_HOURS=48
CHECK_INTERVAL_MINUTES=60
MAX_RETRIES=3
```

---

## 🧪 Testing

### Smart Contract Tests:
```bash
cd contracts
forge test --match-contract "FeeDistributorV2Test|AirdropManagerTest"
```

### Snapshot Generation Test:
```bash
bun run scripts/leaderboard/monthly-distribution.ts --dry-run
```

### Verify Snapshot:
```bash
bun run scripts/leaderboard/verify-snapshot.ts
```

---

## 📚 Documentation

- **EXECUTIVE_SUMMARY.md** - High-level overview
- **COMPLETE_SUMMARY.md** - Full technical details
- **OPTIMIZED_ARCHITECTURE.md** - Architecture decisions
- **NEXT_STEPS.md** - Deployment guide
- **README_PAYMENT_INTEGRATION.md** - This file

---

## 🔐 Security

### Built-In:
- ✅ ReentrancyGuard on all state-changing functions
- ✅ Ownable access control
- ✅ Pausable for emergencies
- ✅ Pull payment pattern
- ✅ 48-hour dispute period
- ✅ Input validation

### Recommended:
- Configure multisig for oracle (3/5 or 4/7)
- Run internal security review
- Consider external audit before mainnet
- Set up monitoring and alerting

---

## ⚠️ Known Issues

### To Fix Before Deployment:
1. **AirdropManager**: Implement `_populateAirdropShares()` (reads from FeeDistributor)
2. **FeeDistributorV2**: Add `getSnapshotContributors()` getter function
3. **ContractClient**: Update with full ABIs after compilation

**Estimated fix time**: 1 hour

---

## 💰 Reward Calculation

### Formula:
```
Weighted Score = (All-time Score × 0.5) + (6-month Score × 0.3) + (1-month Score × 0.2)
Pro-rata Share = Your Weighted Score / Total Weighted Scores
Monthly Reward = Pro-rata Share × Contributor Pool Balance
```

### Example:
```
Monthly protocol fees: 10,000 elizaOS
Contributor pool (10%): 1,000 elizaOS
Your weighted score: 500 points
Total weighted scores: 10,000 points
Your share: 500/10,000 = 5%
Your reward: 1,000 × 5% = 50 elizaOS
```

---

## 🎯 Success Metrics

### Month 1 Targets:
- [ ] 50+ contributors eligible
- [ ] 75%+ claim their rewards
- [ ] < $20 average gas cost to claim
- [ ] 5+ community airdrops created
- [ ] 0 security issues

### Month 3 Targets:
- [ ] 100+ contributors
- [ ] 90%+ claim rate
- [ ] 20+ community airdrops
- [ ] Gas costs optimized by 20%

---

## 🆘 Support

### Common Issues:

**"No rewards showing"**
- Ensure wallet is connected
- Verify wallet address is linked to GitHub account
- Check if snapshot has been finalized

**"Transaction failing"**
- Check gas price
- Verify contract address correct
- Ensure sufficient ETH for gas

**"API errors"**
- Verify environment variables set
- Check database migration ran
- Ensure contracts deployed

### Get Help:
1. Check documentation files in this directory
2. Review tests for usage examples
3. See NEXT_STEPS.md for deployment guide

---

## 🎉 Credits

**Built by**: Claude + Shaw Walters  
**Date**: October 2025  
**License**: MIT  
**Based on**: ElizaOS Leaderboard (forked and adapted)

---

**For detailed technical information, see COMPLETE_SUMMARY.md**


