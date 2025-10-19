# Jeju Network Leaderboard Payment Integration - Complete Implementation Roadmap

## 📋 Executive Summary

This document provides the complete, detailed roadmap for integrating payment distribution into the Jeju Network leaderboard system.

### Goals
1. **Protocol Fee Distribution**: Automatically distribute 10% of protocol fees monthly to contributors based on leaderboard scores
2. **Community Airdrops**: Enable anyone to airdrop tokens to contributors based on weighted scoring

### Total TODOs: 98
- **Smart Contracts**: 8 todos
- **Database**: 6 todos
- **Backend Services**: 7 todos
- **API Endpoints**: 10 todos
- **Frontend**: 12 todos
- **Scripts**: 4 todos
- **Tests**: 18 todos
- **Critical Reviews**: 10 todos
- **Fix All**: 9 todos
- **Final Verification**: 8 todos
- **Deployment**: 6 todos

## 🎯 Success Criteria

**ALL tests must pass at 100%**. No compromises. 99.9% = FAIL.

Every component must be:
- ✅ Fully tested (unit + integration)
- ✅ Critically reviewed
- ✅ Security hardened
- ✅ Gas optimized
- ✅ Properly typed (no `any`)
- ✅ Linter compliant
- ✅ Documented

## 📊 Implementation Phases

### Phase 1: Smart Contracts ⛓️
**Duration**: 2 weeks
**Priority**: CRITICAL

#### Deliverables:
1. `ContributorVault.sol` - Receives 10% of protocol fees, manages monthly distributions
2. `ScoreOracle.sol` - Bridges off-chain scores to on-chain
3. `FeeDistributor.sol` (modified) - Changes split from 50/50 to 45/45/10
4. `AirdropManager.sol` - Enables community token airdrops

#### Key Features:
- Multi-token support (elizaOS, HG, USDC, custom ERC20)
- Reentrancy protection on all state changes
- Pause mechanism for emergencies
- Access control (multisig recommended)
- Dispute mechanism with timelock
- Merkle tree verification for gas efficiency

### Phase 2: Database & Backend 💾
**Duration**: 2 weeks
**Priority**: HIGH

#### New Database Tables:
```sql
contributor_snapshots       -- Monthly score snapshots
contributor_allocations     -- Individual allocations per snapshot
airdrops                    -- Airdrop metadata
airdrop_claims              -- Individual claim tracking
```

#### Backend Services:
1. **Snapshot Generator**
   - Runs monthly (cron job)
   - Calculates weighted scores:
     - 50% all-time score
     - 30% 6-month score
     - 20% 1-month score
   - Generates Merkle tree for verification
   - Stores in database + IPFS

2. **Oracle Bot**
   - Monitors for new snapshots
   - Submits to `ScoreOracle` contract
   - Waits for dispute period (24-48 hours)
   - Finalizes snapshots
   - Handles reorgs and retries

### Phase 3: API Layer 🌐
**Duration**: 1 week
**Priority**: MEDIUM

#### Endpoints:
- `GET /api/claims/:address` - Get claimable rewards
- `GET /api/claims/history/:address` - Claim history
- `GET /api/airdrops` - List all airdrops
- `GET /api/airdrops/:id` - Airdrop details
- `POST /api/airdrops/create` - Create new airdrop
- `GET /api/snapshots/latest` - Latest monthly snapshot
- `GET /api/rewards/estimate/:address` - Estimate next reward

#### Security:
- Input validation (Zod schemas)
- Rate limiting (10 req/min per IP)
- CORS configuration
- SQL injection prevention
- XSS protection

### Phase 4: Frontend Integration 🎨
**Duration**: 2 weeks
**Priority**: MEDIUM

#### New Pages:
1. **Rewards Dashboard** (`/app/rewards/page.tsx`)
   - Claimable rewards per token
   - "Claim All" functionality
   - Claim history table
   - Next distribution countdown
   - Total earned to date

2. **Airdrop Creation** (`/app/airdrops/create/page.tsx`)
   - Token selection dropdown
   - Amount input
   - Distribution preview (top 10 recipients)
   - Transaction confirmation
   - Success page with airdrop ID

3. **Enhanced Leaderboard** (updated)
   - "Estimated Monthly Reward" column
   - Total reward pool display
   - Links to rewards page
   - Top earner badges

#### Components:
- Wallet connection (wagmi/viem)
- Transaction status toasts
- Loading states
- Error boundaries
- Responsive design

### Phase 5: Testing 🧪
**Duration**: 2 weeks
**Priority**: CRITICAL

#### Test Coverage Requirements:
- **Unit Tests**: 100% coverage on critical paths
- **Integration Tests**: All major flows
- **E2E Tests**: Complete user journeys
- **Security Tests**: Vulnerability scanning
- **Performance Tests**: Gas optimization, API response times

#### Test Matrix:
```
Smart Contracts:
  ✓ ContributorVault     - 20+ test cases
  ✓ ScoreOracle          - 15+ test cases
  ✓ FeeDistributor       - 10+ test cases
  ✓ AirdropManager       - 20+ test cases

Backend:
  ✓ Snapshot generation  - 10+ test cases
  ✓ Score weighting      - 8+ test cases
  ✓ Merkle tree          - 6+ test cases
  ✓ Oracle bot           - 12+ test cases

API:
  ✓ Claims endpoints     - 15+ test cases
  ✓ Airdrops endpoints   - 15+ test cases
  ✓ Snapshots endpoints  - 8+ test cases

Frontend:
  ✓ Rewards page         - 10+ test cases
  ✓ Airdrop creation     - 12+ test cases
  ✓ Leaderboard updates  - 8+ test cases

Integration:
  ✓ Monthly distribution - Full cycle test
  ✓ Airdrop flow         - Creation to claim
  ✓ Multi-token          - All supported tokens
```

### Phase 6: Critical Review 🔍
**Duration**: 1 week
**Priority**: CRITICAL

Every component undergoes thorough review:
1. **Security Review**: Reentrancy, overflow, access control
2. **Logic Review**: Score calculation accuracy, fee distribution
3. **Gas Optimization**: Minimize costs
4. **Code Quality**: TypeScript types, no `any`, proper error handling
5. **Documentation**: Inline comments, README, API docs

### Phase 7: Fix All Issues 🔧
**Duration**: 1-2 weeks
**Priority**: CRITICAL

Iterative fixing until:
- ✅ 100% test pass rate (not 99.9%)
- ✅ 0 critical/high security issues
- ✅ 0 linter errors
- ✅ 0 TypeScript errors
- ✅ All performance benchmarks met

### Phase 8: Deployment 🚀
**Duration**: 2 weeks
**Priority**: HIGH

#### Testnet Deployment:
1. Deploy all contracts
2. Run 3 complete monthly cycles
3. Test with 10-20 real contributors
4. Gather feedback and iterate

#### Mainnet Deployment:
1. External security audit (recommended)
2. Community announcement (7 days notice)
3. Deploy contracts with multisig
4. Monitor first distribution closely
5. Optimize based on real usage

## 📈 Milestones

| Week | Milestone | Deliverables |
|------|-----------|--------------|
| 1-2  | Smart Contracts Complete | All 4 contracts deployed to testnet |
| 3-4  | Backend Services Complete | Snapshot generation + Oracle bot working |
| 5    | API Layer Complete | All 7 endpoints functional |
| 6-7  | Frontend Complete | All 3 pages + wallet integration |
| 8-9  | Testing Complete | 100% pass rate achieved |
| 10   | Review Complete | All components critically reviewed |
| 11   | Fixes Complete | All issues resolved |
| 12   | Testnet Validated | 3 full cycles successfully run |
| 13   | Audit Complete | External security audit passed |
| 14   | Mainnet Deployed | First distribution scheduled |

## 🔐 Security Considerations

### Smart Contract Security:
- [ ] Reentrancy guards on all external calls
- [ ] Integer overflow protection (Solidity 0.8+)
- [ ] Access control with multisig
- [ ] Pause mechanism for emergencies
- [ ] Time-locks on critical operations
- [ ] External audit before mainnet

### Oracle Security:
- [ ] Multisig control (3/5 recommended)
- [ ] 24-48 hour dispute window
- [ ] Cryptographic proof (Merkle tree)
- [ ] Off-chain backup of all snapshots
- [ ] Rate limiting on submissions
- [ ] Monitoring and alerting

### API Security:
- [ ] Input validation (Zod)
- [ ] Rate limiting per IP
- [ ] CORS whitelist
- [ ] SQL injection prevention
- [ ] XSS protection
- [ ] Authentication for sensitive endpoints

### Frontend Security:
- [ ] Wallet connection best practices
- [ ] Transaction signing verification
- [ ] User input sanitization
- [ ] Error messages (no sensitive data)
- [ ] HTTPS only
- [ ] Content Security Policy

## 💰 Gas Optimization Targets

| Operation | Target Gas | Current Estimate |
|-----------|------------|------------------|
| Claim single reward | < 100k | TBD |
| Claim batch (5 airdrops) | < 250k | TBD |
| Create airdrop | < 200k | TBD |
| Submit snapshot | < 150k | TBD |
| Finalize snapshot | < 80k | TBD |

## 📚 Documentation Requirements

### Smart Contracts:
- [ ] NatSpec comments on all public functions
- [ ] Architecture diagram
- [ ] Deployment guide
- [ ] Upgrade process

### Backend:
- [ ] README with setup instructions
- [ ] Environment variables documentation
- [ ] Cron job configuration
- [ ] Monitoring guide

### API:
- [ ] OpenAPI/Swagger spec
- [ ] Example requests/responses
- [ ] Authentication guide
- [ ] Rate limit documentation

### Frontend:
- [ ] User guide (claim flow)
- [ ] Airdrop creation tutorial
- [ ] Wallet connection guide
- [ ] Troubleshooting guide

## 🎯 Acceptance Criteria

Before marking complete, EVERY item must meet:

### Code Quality:
- ✅ 100% test coverage on critical paths
- ✅ 100% test pass rate
- ✅ No `any` types (use proper TypeScript)
- ✅ No linter errors
- ✅ Proper error handling
- ✅ Inline documentation

### Security:
- ✅ Security review completed
- ✅ No critical/high vulnerabilities
- ✅ Access control verified
- ✅ Reentrancy protection confirmed
- ✅ Input validation implemented

### Performance:
- ✅ Gas costs within targets
- ✅ API response times < 500ms
- ✅ Database queries optimized
- ✅ Frontend bundle size reasonable

### User Experience:
- ✅ Clear error messages
- ✅ Loading states
- ✅ Transaction status feedback
- ✅ Mobile responsive
- ✅ Accessibility (WCAG AA)

## 🚨 Risk Mitigation

### Technical Risks:
| Risk | Mitigation |
|------|-----------|
| Oracle manipulation | Multisig control + dispute mechanism |
| Smart contract bugs | External audit + extensive testing |
| Database corruption | Regular backups + transaction safety |
| API overload | Rate limiting + caching |
| Gas price spikes | Batch operations + optimization |

### Business Risks:
| Risk | Mitigation |
|------|-----------|
| Low contributor adoption | Clear documentation + tutorials |
| High claim gas costs | Gas optimization + batch claims |
| Airdrop spam | Minimum token amount + rate limits |
| Contributor disputes | Transparent scoring + dispute process |

## 📞 Support Plan

### Documentation:
- Comprehensive user guides
- Video tutorials
- FAQ section
- Troubleshooting guide

### Community:
- Discord support channel
- GitHub issues
- Weekly office hours
- Contributor forum

### Monitoring:
- Contract event monitoring
- API uptime tracking
- Error rate alerting
- Gas price monitoring

## 🎉 Success Metrics

### Month 1:
- [ ] 50%+ contributors claim rewards
- [ ] 5+ community airdrops created
- [ ] < 0.1% error rate
- [ ] 99.9%+ API uptime

### Month 3:
- [ ] 75%+ contributors claim rewards
- [ ] 20+ community airdrops
- [ ] Gas costs reduced 20%
- [ ] 10+ new contributors attracted

### Month 6:
- [ ] 90%+ contributors claim rewards
- [ ] 50+ community airdrops
- [ ] System fully automated
- [ ] 25+ new contributors

## 🔄 Iteration Plan

After initial deployment:
1. **Week 1-2**: Monitor closely, fix critical issues
2. **Week 3-4**: Optimize gas costs based on real usage
3. **Month 2**: Add requested features
4. **Month 3**: Implement improvements from feedback
5. **Ongoing**: Monthly review and optimization

## ✅ Final Checklist

Before mainnet deployment:
- [ ] All 98 TODOs completed
- [ ] 100% test pass rate confirmed
- [ ] Security audit passed
- [ ] Documentation complete
- [ ] Testnet validated (3 cycles)
- [ ] Community announced
- [ ] Multisig configured
- [ ] Monitoring set up
- [ ] Emergency procedures documented
- [ ] Go/no-go meeting held

---

## 🎯 Next Immediate Actions

1. Review this plan with the team
2. Assign ownership of each phase
3. Set up development environment (testnet)
4. Begin smart contract development
5. Daily standups to track progress

**Remember**: 100% = Success. 99.9% = Failure. No compromises on quality, security, or testing.


