# Uniswap V4 Mainnet Deployment Checklist

Comprehensive security-focused checklist for deploying Uniswap V4 on Jeju Mainnet.

## Overview

- **Network**: Jeju Mainnet (Chain ID: 420691)
- **Settlement**: Base Mainnet (Chain ID: 8453)
- **Gas Requirements**: Significant ETH needed for deployment
- **Time**: 2-4 hours (plus audit/testing time)
- **Difficulty**: Advanced
- **Risk**: High - Production deployment with real assets

::: danger Security Critical
This is a production mainnet deployment. Any mistakes can result in loss of funds, exploits, or network issues. Every step must be reviewed by multiple team members. Do not proceed unless you have:
- Completed extensive testnet testing
- Completed security audits (if deploying custom hooks)
- Set up monitoring and incident response
- Obtained necessary approvals
:::

## What is Uniswap V4?

Uniswap V4 is a revolutionary DEX architecture featuring:

- **Singleton Architecture**: One PoolManager contract manages all pools (massive gas savings)
- **Hooks System**: Programmable liquidity pools with 8 customization points
- **Flash Accounting**: EIP-1153 transient storage for 99%+ gas reduction
- **Native ETH**: Direct ETH trading without WETH wrapping
- **Custom AMM Curves**: Full flexibility in pricing functions

**Key Security Considerations:**
- PoolManager is immutable once deployed
- Hooks can introduce vulnerabilities if not audited
- Initial ownership and permissions are critical
- No built-in pause mechanism (must be in hooks if needed)

---

## Pre-Deployment Requirements

### Business & Legal Requirements

- [ ] **Legal entity established** (LLC, Foundation, or DAO)
- [ ] **Terms of Service** reviewed by legal counsel
- [ ] **Regulatory compliance** verified for your jurisdiction
- [ ] **Insurance coverage** obtained (if applicable)
- [ ] **Incident response plan** documented and tested
- [ ] **24/7 on-call rotation** scheduled (minimum 3 engineers)
- [ ] **Communication plan** for incidents (Discord, Twitter, email)
- [ ] **Budget approved** for deployment and ongoing operations

### Security Audit Requirements

::: danger Required for Custom Hooks
If deploying custom hooks, security audits are mandatory. PoolManager itself is audited by Uniswap, but hooks are your responsibility.
:::

- [ ] **Smart contract audit completed** (if deploying hooks)
  - Recommended firms: Trail of Bits, OpenZeppelin, Spearbit, Consensys Diligence
  - Timeline: 2-4 weeks
- [ ] **All critical findings resolved**
- [ ] **All high severity findings resolved**
- [ ] **Medium findings reviewed and risk-accepted or resolved**
- [ ] **Audit report published** (transparency builds trust)
- [ ] **Bug bounty program live** before mainnet
  - Recommend Immunefi or Code4rena
  - Set appropriate reward levels based on severity

### Testnet Validation Requirements

::: warning Testnet is Not Optional
Do not deploy to mainnet without extensive testnet validation. Minimum 4 weeks of stable testnet operation required.
:::

- [ ] **Testnet deployment running for 4+ weeks**
- [ ] **Zero critical bugs on testnet**
- [ ] **Load testing completed** (target: 1000+ transactions)
- [ ] **All pool types tested** (if using multiple configurations)
- [ ] **Hook functionality tested** (if applicable)
- [ ] **Integration testing complete** (frontend, backend, APIs)
- [ ] **Monitoring and alerting tested**
- [ ] **Incident response runbooks validated**
- [ ] **Team trained on all operational procedures**

### Financial Requirements

**Deployment Capital**:
- [ ] Deployer account: Significant ETH for deployment
- [ ] Testing account: ETH for post-deployment testing
- [ ] Emergency fund: Reserve ETH for incident response

**Ongoing Operating Costs**:
- [ ] Monitoring infrastructure
- [ ] Bug bounty program
- [ ] Insurance (if obtained)

### Team Requirements

- [ ] **Minimum 3 engineers** for 24/7 on-call rotation
- [ ] **Smart contract engineer** familiar with Uniswap V4
- [ ] **DevOps/Infrastructure engineer** for monitoring
- [ ] **Security engineer** for incident response
- [ ] **PagerDuty or equivalent** alerting configured
- [ ] **Communication channels** established (Discord, Telegram, Email)
- [ ] **Escalation procedures** documented
- [ ] **All team members have hardware wallets**

### Technical Requirements

- [ ] **Hardware wallet** for deployment (Ledger or Trezor required)
- [ ] **Multisig wallet** for ownership (if transferring ownership)
- [ ] **Monitoring infrastructure** ready (Grafana, alerts, etc.)
- [ ] **Backup RPC endpoints** configured
- [ ] **Block explorer access** verified
- [ ] **All tools updated** to latest stable versions

---

## Phase 1: Security Setup

### Step 1.1: Hardware Wallet Setup

::: danger Never Use Hot Wallets for Mainnet
Production deployments must use hardware wallets. Private keys should never be stored in plain text.
:::

**Required: Ledger or Trezor Hardware Wallet**

1. **Purchase Hardware Wallet**
   - Buy directly from manufacturer (never third-party)
   - Verify package integrity
   - Initialize with strong entropy

2. **Generate Deployment Account**
   ```bash
   # Connect hardware wallet
   # Generate new Ethereum account
   # Record address

   export DEPLOYER_ADDRESS="0xYOUR_HARDWARE_WALLET_ADDRESS"
   ```

3. **Secure Seed Phrase**
   - [ ] Write down seed phrase (never digital)
   - [ ] Store in bank safe deposit box
   - [ ] Create 2-3 backup copies
   - [ ] Store backups in separate secure locations
   - [ ] Test recovery process on test device
   - [ ] Never photograph or screenshot seed phrase

4. **Verify Hardware Wallet**
   ```bash
   # Check address on device screen matches
   # Test with small testnet transaction first
   ```

- [ ] Hardware wallet purchased and initialized
- [ ] Seed phrase secured in multiple locations
- [ ] Recovery process tested
- [ ] Address verified on device

### Step 1.2: Multisig Setup (Recommended)

For enhanced security, transfer ownership to multisig after deployment:

**Operations Multisig** (3-of-5, for routine operations):
- Daily operations
- Emergency pause (if implemented in hooks)
- Parameter updates

```bash
# Deploy Gnosis Safe or use existing
# Configure signers (all with hardware wallets)
# Test multisig operations on testnet

export OPERATIONS_MULTISIG="0xYOUR_MULTISIG_ADDRESS"
```

- [ ] Multisig wallet deployed/configured
- [ ] All signers have hardware wallets
- [ ] Signing procedures documented
- [ ] Test transactions executed on testnet

### Step 1.3: Fund Deployment Account

**Mainnet ETH Required:**

```bash
# Calculate deployment cost
# PoolManager deployment: ~2-3 ETH at 50 gwei
# Safety buffer: +1 ETH

# Check current gas prices
cast gas-price --rpc-url https://rpc.jeju.network

# Fund account (via secure method)
# - Transfer from hardware wallet
# - Use secure exchange withdrawal
# - Never use custodial hot wallet

# Verify balance
cast balance $DEPLOYER_ADDRESS --rpc-url https://rpc.jeju.network

# Should have 2-3 ETH minimum
```

**Funding Checklist:**
- [ ] Gas prices checked and acceptable
- [ ] Account funded via secure method
- [ ] Transaction confirmed on block explorer
- [ ] Balance verified (2-3 ETH minimum)
- [ ] Funding transaction recorded

---

## Phase 2: Pre-Deployment Validation

### Step 2.1: Final Code Review

**48 Hours Before Deployment:**

- [ ] **Code freeze** implemented (no changes after this point)
- [ ] **Final review** by 3+ engineers
- [ ] **All tests passing** (100% pass rate required)
- [ ] **Test coverage verified** (>90% for custom hooks)
- [ ] **Gas optimization** reviewed
- [ ] **No hardcoded values** that should be configurable
- [ ] **Documentation complete** and reviewed

```bash
cd contracts

# Pull latest changes
git pull origin main
git submodule update --init --recursive

# Verify v4-core version
cd lib/v4-core
git describe --tags
# Should show stable release tag

# Build contracts
cd ../..
forge build --use 0.8.26

# Run all tests
forge test

# Check test coverage (if applicable for hooks)
forge coverage
```

- [ ] Code freeze in effect
- [ ] Review complete (minimum 3 engineers)
- [ ] All tests passing
- [ ] Build successful

### Step 2.2: Deployment Rehearsal

**24 Hours Before Deployment:**

Test the entire deployment process on a mainnet fork:

```bash
# Start mainnet fork
anvil --fork-url https://rpc.jeju.network --chain-id 420691

# In another terminal, deploy to fork
export JEJU_NETWORK="localnet"
export JEJU_RPC_URL="http://localhost:8545"
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

bun run scripts/deploy-uniswap-v4.ts

# Verify deployment worked
bun run scripts/verify-uniswap-v4-deployment.ts --network localnet

# Time the deployment
# Estimate gas costs
# Verify all outputs
```

- [ ] Fork deployment successful
- [ ] Deployment time estimated (<10 minutes)
- [ ] Gas costs calculated and approved
- [ ] All team members understand their roles

### Step 2.3: Environment Preparation

**Day of Deployment:**

```bash
# Verify all prerequisites
cd /path/to/jeju

# Update repository
git pull origin main
git submodule update --init --recursive

# Verify tools
bun --version  # Should be 1.0.0+
forge --version  # Should be latest stable

# Verify network connectivity
cast block latest --rpc-url https://rpc.jeju.network

# Verify deployer balance
cast balance $DEPLOYER_ADDRESS --rpc-url https://rpc.jeju.network
```

- [ ] Repository up to date
- [ ] Tools verified
- [ ] Network accessible
- [ ] Balance sufficient

---

## Phase 3: Deployment

### Step 3.1: Pre-Deployment Meeting

::: warning Team Coordination Required
All engineers must be present and on video call during deployment.
:::

**30 Minutes Before Deployment:**

1. **Team Assembly**
   - [ ] All engineers on video call
   - [ ] Screen sharing enabled
   - [ ] Recording started (for documentation)
   - [ ] Incident response team on standby

2. **Pre-Deployment Checklist**
   - [ ] Hardware wallet connected and unlocked
   - [ ] Deployer account has sufficient ETH (2-3 ETH)
   - [ ] Gas price is reasonable (<100 gwei)
   - [ ] Jeju Mainnet is stable (no outages)
   - [ ] Block explorer accessible
   - [ ] Monitoring dashboards ready
   - [ ] Communication channels ready (Discord, Twitter)

3. **Approval**
   - [ ] Technical lead approval
   - [ ] Security lead approval
   - [ ] Project lead approval
   - [ ] All concerns addressed

### Step 3.2: Mainnet Deployment

::: danger Point of No Return
Once deployed, contracts are immutable. Triple-check everything before proceeding.
:::

```bash
cd /path/to/jeju

# Set environment variables
export JEJU_NETWORK="mainnet"
export JEJU_RPC_URL="https://rpc.jeju.network"

# For hardware wallet deployment with Ledger:
# Connect Ledger, unlock, open Ethereum app
# Use --ledger flag with forge (advanced usage)

# For secure private key deployment:
# Store key in secure file with restricted permissions
chmod 600 .mainnet-deployer-key
export PRIVATE_KEY=$(cat .mainnet-deployer-key)

# FINAL VERIFICATION
echo "Network: $JEJU_NETWORK"
echo "RPC: $JEJU_RPC_URL"
echo "Deployer: $(cast wallet address --private-key $PRIVATE_KEY)"
echo ""
echo "Press Ctrl+C within 10 seconds to abort..."
sleep 10

# DEPLOY
echo "Starting deployment..."
bun run scripts/deploy-uniswap-v4.ts

# Expected output:
# ======================================================================
# Deploying Uniswap V4 to Jeju
# ======================================================================
#
# Network: mainnet
# RPC URL: https://rpc.jeju.network
# Chain ID: 420691
# ...
# ✅ PoolManager deployed: 0x...
# ✅ Deployment verified successfully!
# 📝 Deployment saved

# RECORD THE POOLMANAGER ADDRESS IMMEDIATELY
export POOL_MANAGER="0xYOUR_DEPLOYED_ADDRESS"
```

**During Deployment:**
- [ ] All team members watching
- [ ] Transactions monitored on block explorer
- [ ] No interruptions to process
- [ ] PoolManager address recorded
- [ ] Deployment completed successfully

**Expected Duration:** 5-10 minutes

### Step 3.3: Immediate Post-Deployment Verification

```bash
# Verify deployment immediately
bun run scripts/verify-uniswap-v4-deployment.ts --network mainnet --verbose

# Should show:
# ✅ All verification checks passed! (6/6)

# Manual verification
echo "PoolManager: $POOL_MANAGER"

# Check contract code
cast code $POOL_MANAGER --rpc-url https://rpc.jeju.network
# Should return long hex string

# Check owner
cast call $POOL_MANAGER "owner()" --rpc-url https://rpc.jeju.network
# Should return your deployer address

# Verify on block explorer
echo "Verify on explorer: https://explorer.jeju.network/address/$POOL_MANAGER"
```

- [ ] Verification script passed (6/6)
- [ ] Manual checks passed
- [ ] Contract visible on block explorer
- [ ] Owner is correct deployer address

### Step 3.4: Save All Deployment Information

```bash
# Deployment info automatically saved
cat contracts/deployments/uniswap-v4-420691.json

# Create backup
cp contracts/deployments/uniswap-v4-420691.json \
   contracts/deployments/uniswap-v4-420691-$(date +%Y%m%d-%H%M%S).json

# Record deployment details
cat > DEPLOYMENT_RECORD.md <<EOF
# Uniswap V4 Mainnet Deployment

**Date**: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Network**: Jeju Mainnet (420691)
**Deployer**: $DEPLOYER_ADDRESS
**PoolManager**: $POOL_MANAGER

## Deployment Transaction
- Hash: [Check block explorer]
- Block: [Check block explorer]
- Gas Used: [Check block explorer]

## Verification
- Verification Script: ✅ Passed (6/6)
- Block Explorer: [URL]
- Team: [Names of engineers present]

## Next Steps
- [ ] Transfer ownership (if applicable)
- [ ] Set up monitoring
- [ ] Announce deployment
EOF

cat DEPLOYMENT_RECORD.md
```

- [ ] Deployment file saved and backed up
- [ ] Deployment record created
- [ ] All details documented
- [ ] Backups stored securely

---

## Phase 4: Post-Deployment Operations

### Step 4.1: Transfer Ownership (If Using Multisig)

::: warning Optional But Recommended
For production systems, consider transferring ownership to a multisig for enhanced security.
:::

```bash
# If transferring ownership to multisig:

# Prepare transaction (DO NOT EXECUTE YET)
cast calldata "transferOwnership(address)" $OPERATIONS_MULTISIG

# Review with team
# Execute transfer
cast send $POOL_MANAGER \
  "transferOwnership(address)" \
  $OPERATIONS_MULTISIG \
  --rpc-url https://rpc.jeju.network \
  --private-key $PRIVATE_KEY

# Verify new owner
cast call $POOL_MANAGER "owner()" --rpc-url https://rpc.jeju.network
# Should return $OPERATIONS_MULTISIG

# Test multisig can perform operations
# (via Gnosis Safe UI or similar)
```

- [ ] Ownership transfer decision made
- [ ] If transferring: executed successfully
- [ ] New owner verified
- [ ] Multisig tested (if applicable)

### Step 4.2: Set Up Monitoring

**Contract Monitoring:**

```bash
# Set up contract monitoring
# Options:
# 1. Tenderly (recommended)
# 2. OpenZeppelin Defender
# 3. Custom monitoring with Grafana

# Monitor:
# - Contract calls
# - Gas usage
# - Failed transactions
# - Unusual patterns

# Set up alerts for:
# - High gas consumption
# - Failed transactions
# - Ownership changes (if applicable)
# - Large value transactions
```

**Alert Configuration:**

```yaml
# Example alert rules (adapt to your monitoring system)
alerts:
  - name: "PoolManager Unusual Activity"
    condition: "transaction_count > 1000/hour"
    severity: warning

  - name: "PoolManager Failed Transactions"
    condition: "failed_tx_count > 10/hour"
    severity: critical

  - name: "PoolManager High Gas"
    condition: "gas_used > 50M/day"
    severity: warning
```

- [ ] Monitoring system configured
- [ ] Dashboards created
- [ ] Alerts configured
- [ ] Alert notifications tested
- [ ] On-call schedule activated

### Step 4.3: Documentation Update

```bash
# Update public documentation
cd apps/documentation

# Update relevant files with PoolManager address
# - deployment/mainnet.md
# - developers/defi-protocols.md
# - network/mainnet.md

# Commit changes
git add .
git commit -m "docs: add Uniswap V4 mainnet deployment"
git push
```

- [ ] Documentation updated
- [ ] PoolManager address published
- [ ] Integration guides updated
- [ ] Changes committed and pushed

---

## Phase 5: Testing & Validation

### Step 5.1: Smoke Testing

**Immediate Tests (First Hour):**

```bash
# Test basic contract calls (read-only)
cast call $POOL_MANAGER "owner()" --rpc-url https://rpc.jeju.network
cast call $POOL_MANAGER "MAX_TICK_SPACING()" --rpc-url https://rpc.jeju.network
cast call $POOL_MANAGER "MIN_TICK_SPACING()" --rpc-url https://rpc.jeju.network

# Monitor for any issues
# Watch block explorer for any unexpected interactions
```

- [ ] Read-only calls successful
- [ ] No unexpected errors
- [ ] Contract behaving as expected

### Step 5.2: Integration Testing

**First 24 Hours:**

If you have applications integrating with the PoolManager:

```bash
# Update application configs with new address
# Test integration in staging environment first
# Deploy to production only after successful staging tests

# Monitor:
# - Application logs
# - User transactions
# - Gas costs
# - Error rates
```

- [ ] Staging integration successful
- [ ] Production integration tested
- [ ] No integration issues
- [ ] User transactions working

### Step 5.3: Community Testing

**First Week:**

- [ ] Announce deployment to community
- [ ] Provide integration documentation
- [ ] Monitor community feedback
- [ ] Address any issues quickly
- [ ] Track adoption metrics

---

## Phase 6: Public Announcement

### Step 6.1: Prepare Announcement

**Content Checklist:**

```markdown
# Uniswap V4 Now Live on Jeju Mainnet! 🎉

We're excited to announce that Uniswap V4 is now deployed on Jeju Mainnet!

## Contract Details
- **PoolManager**: 0x[YOUR_ADDRESS]
- **Network**: Jeju Mainnet (Chain ID: 420691)
- **Explorer**: [Link to explorer]

## What's New in V4?
- Singleton architecture for gas efficiency
- Hooks system for customizable pools
- Flash accounting for reduced gas costs
- Native ETH support

## For Developers
- Integration guide: [link]
- Documentation: [link]
- Example code: [link]

## Security
- Uniswap V4 core contracts audited by [firms]
- Bug bounty program: [link]
- Security contact: security@jeju.network

## Get Started
[Links to documentation and resources]
```

- [ ] Announcement drafted
- [ ] Reviewed by team
- [ ] Links verified
- [ ] Contact information correct

### Step 6.2: Publish Announcement

**Channels:**

1. **Twitter/X**
   ```
   🎉 Uniswap V4 is now live on @JejuNetwork!

   ✅ Gas-efficient singleton architecture
   ✅ Programmable liquidity via hooks
   ✅ Flash accounting with EIP-1153

   PoolManager: 0x...

   Docs: [link]

   #DeFi #Uniswap #Web3
   ```

2. **Discord**
   - Announcement in #announcements channel
   - Technical details in #developers channel
   - Pin message

3. **Documentation Site**
   - Publish blog post
   - Update homepage
   - Add to featured deployments

4. **GitHub**
   - Create release tag
   - Update README
   - Close related issues

- [ ] Twitter announcement posted
- [ ] Discord announcement posted
- [ ] Blog post published
- [ ] GitHub updated
- [ ] Community notified

---

## Phase 7: Ongoing Operations

### Daily Operations (First Week)

**Daily Checklist:**

- [ ] Review monitoring dashboards
- [ ] Check for any failed transactions
- [ ] Monitor gas usage patterns
- [ ] Review community feedback
- [ ] Check for any security alerts
- [ ] Verify backup systems operational
- [ ] Team check-in meeting

**Metrics to Track:**

```bash
# Daily metrics
- Total pools created
- Total liquidity (TVL)
- Transaction volume
- Unique users
- Gas costs
- Error rates
- Integration uptake
```

### Weekly Operations (First Month)

**Weekly Checklist:**

- [ ] Review weekly metrics
- [ ] Analyze gas optimization opportunities
- [ ] Review security alerts
- [ ] Update documentation based on feedback
- [ ] Plan improvements/features
- [ ] Team retrospective
- [ ] Stakeholder update

### Incident Response

**If Issues Arise:**

1. **Assess Severity**
   - Critical: Funds at risk, contract exploit
   - High: Functionality broken, widespread issues
   - Medium: Performance degradation, limited impact
   - Low: Minor bugs, cosmetic issues

2. **Immediate Response (Critical/High)**
   ```bash
   # Assemble incident response team
   # Assess impact and root cause
   # Communicate with community immediately
   # Implement fix or mitigation
   # Post-mortem after resolution
   ```

3. **Communication Template**
   ```
   ⚠️ [INCIDENT] Uniswap V4 on Jeju - [Brief Description]

   Status: [Investigating / Identified / Resolving / Resolved]

   Impact: [Description]

   Actions:
   - [Action 1]
   - [Action 2]

   Timeline:
   - [Timestamp]: Incident detected
   - [Timestamp]: Team assembled
   - [Timestamp]: Root cause identified

   Updates will be posted every [frequency].

   For questions: [contact method]
   ```

- [ ] Incident response plan reviewed
- [ ] Team roles assigned
- [ ] Communication templates ready
- [ ] Escalation procedures clear

---

## Security Best Practices

### Ongoing Security

1. **Monitor Bug Bounty Reports**
   - Review submissions promptly
   - Validate findings
   - Pay rewards fairly and quickly
   - Thank researchers publicly (with permission)

2. **Keep Dependencies Updated**
   ```bash
   # Regularly check for updates
   cd contracts/lib/v4-core
   git fetch --tags

   # Review release notes before updating
   # Test thoroughly before deploying updates
   ```

3. **Security Monitoring**
   - [ ] Automated security scanning (e.g., Forta)
   - [ ] Anomaly detection configured
   - [ ] Regular security reviews
   - [ ] Penetration testing (annually)

4. **Access Control**
   - [ ] Hardware wallets for all privileged operations
   - [ ] Multisig for critical functions
   - [ ] Regular access audits
   - [ ] Principle of least privilege

### Emergency Procedures

**In Case of Exploit or Critical Bug:**

1. **Immediate Actions (Minutes 0-30)**
   ```bash
   # Assemble full team + security experts
   # Assess impact and affected users
   # Contact audit partners
   # Prepare communication
   # DO NOT PANIC - measured response is critical
   ```

2. **Short Term (Hours 1-24)**
   - Investigate root cause
   - Develop mitigation plan
   - Communicate updates every 2-4 hours
   - Contact affected users
   - Coordinate with exchanges if needed

3. **Medium Term (Days 1-7)**
   - Implement fix
   - Security audit of fix
   - Test thoroughly
   - Prepare deployment
   - Publish detailed post-mortem

4. **Long Term (Weeks 1-4)**
   - Deploy fix
   - Monitor closely
   - Implement additional safeguards
   - Update procedures
   - Compensation plan (if applicable)

- [ ] Emergency procedures documented
- [ ] Contact list maintained
- [ ] Communication channels ready
- [ ] Runbooks tested

---

## Rollback Procedures

::: warning Contracts Are Immutable
Uniswap V4 PoolManager cannot be upgraded or rolled back. Plan for this:
- Extensive testing before deployment
- Security audits for custom components
- Bug bounty program
- Incident response plan
:::

**If Deployment Has Critical Issues:**

There is no rollback for deployed contracts. Options:

1. **If caught immediately (within minutes)**
   - Deploy new corrected PoolManager
   - DO NOT announce old deployment
   - Mark old deployment as deprecated

2. **If pools already created**
   - Migrate to new deployment
   - Coordinate with liquidity providers
   - Provide migration tools
   - May require LP compensation

3. **If hooks have issues**
   - Deploy corrected hooks
   - Update affected pools
   - Migrate liquidity if needed

**Prevention is Critical:**
- Thorough testing on testnet (4+ weeks)
- Multiple security audits
- Gradual rollout
- Monitoring and alerts

---

## Success Criteria

### Immediate Success (First 24 Hours)

- [ ] Deployment completed without errors
- [ ] All verification checks pass
- [ ] Contract functioning as expected
- [ ] No security incidents
- [ ] Team confident in deployment
- [ ] Monitoring operational

### Short Term Success (First Week)

- [ ] Stable operation (99.9%+ uptime)
- [ ] Positive community feedback
- [ ] First integrations successful
- [ ] No critical bugs discovered
- [ ] Documentation well-received
- [ ] Support channels operating smoothly

### Medium Term Success (First Month)

- [ ] Growing adoption
- [ ] Multiple pools created
- [ ] Liquidity provided
- [ ] Active developer ecosystem
- [ ] No security incidents
- [ ] Performance meets expectations
- [ ] Gas costs competitive

---

## Mainnet vs Testnet Differences

| Aspect | Testnet | Mainnet |
|--------|---------|---------|
| **Private Keys** | Can use default keys | MUST use hardware wallet |
| **Audits** | Not required | Required for custom hooks |
| **Testing** | Good to have | Mandatory (4+ weeks) |
| **Monitoring** | Optional | Required 24/7 |
| **Team** | 1-2 engineers | 3+ engineers with on-call |
| **Announcements** | Informal | Formal and coordinated |
| **Bug Bounty** | Not needed | Required |
| **Incident Response** | Best effort | Documented and tested |
| **Cost** | Minimal | 2-5 ETH + ongoing |
| **Risk** | Low | High |

---

## Common Questions

### Q: Is the PoolManager upgradeable?

**A**: No. Uniswap V4 PoolManager is immutable once deployed. This is by design for security and simplicity. If you need upgradeability, implement it in your hooks, not in PoolManager.

### Q: Can I pause the PoolManager in an emergency?

**A**: The core PoolManager has no pause functionality. If you need emergency pause, implement it in your custom hooks.

### Q: What if I discover a bug after deployment?

**A**:
- Minor bugs: Document and work around in hooks/integrations
- Critical bugs: May require deploying new PoolManager and migrating
- Report to bug bounty program for community validation

### Q: Should I transfer ownership to a multisig?

**A**: Recommended for production deployments. Benefits:
- Prevents single point of failure
- Requires multiple approvals for critical operations
- Increases trust from community
- Reduces risk of key compromise

### Q: How do I handle a security incident?

**A**: Follow incident response plan:
1. Assemble team immediately
2. Assess severity and impact
3. Communicate transparently with community
4. Implement mitigation
5. Publish detailed post-mortem
6. Update procedures to prevent recurrence

### Q: What about gas optimization?

**A**: Uniswap V4 is already highly optimized through:
- Singleton architecture
- Flash accounting (EIP-1153)
- Efficient encoding
- Optimized storage patterns

Focus optimization efforts on your hooks, not PoolManager.

### Q: How do I integrate with frontends?

**A**:
1. Use the PoolManager address in your app
2. Import Uniswap V4 ABIs
3. Follow Uniswap V4 integration guides
4. Test thoroughly on testnet first
5. Provide clear documentation for users

---

## Resources

### Official Uniswap V4 Documentation
- [V4 Overview](https://docs.uniswap.org/contracts/v4/overview)
- [Hooks Guide](https://docs.uniswap.org/contracts/v4/guides/hooks/)
- [Architecture](https://docs.uniswap.org/contracts/v4/concepts/architecture)
- [V4 Core Repository](https://github.com/Uniswap/v4-core)
- [V4 Periphery (Examples)](https://github.com/Uniswap/v4-periphery)

### Jeju Network Documentation
- [Mainnet Deployment Guide](./mainnet.md)
- [Network Configuration](/network/mainnet)
- [Developer Documentation](/developers/quick-start)
- [Architecture Overview](/architecture)

### Security Resources
- [Uniswap V4 Security Audits](https://github.com/Uniswap/v4-core/tree/main/audits)
- [Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [Trail of Bits Security Guide](https://github.com/crytic/building-secure-contracts)

### Tools & Services
- [Foundry (Forge/Cast)](https://book.getfoundry.sh/)
- [Tenderly (Monitoring)](https://tenderly.co/)
- [OpenZeppelin Defender](https://defender.openzeppelin.com/)
- [Gnosis Safe (Multisig)](https://safe.global/)
- [Immunefi (Bug Bounty)](https://immunefi.com/)

### Support & Community
- **Discord**: [#dev-support](https://discord.gg/jeju) (for technical questions)
- **GitHub**: [elizaos/jeju](https://github.com/elizaos/jeju/issues) (for bug reports)
- **Email**: dev@jeju.network (for general inquiries)
- **Security**: security@jeju.network (for security issues - DO NOT publicly disclose)
- **Twitter**: [@JejuNetwork](https://twitter.com/jejunetwork) (for announcements)

---

## Final Sign-Off

**Before considering deployment complete:**

- [ ] All checklist items completed
- [ ] Deployment verified by multiple engineers
- [ ] Monitoring operational and tested
- [ ] Team trained and on-call scheduled
- [ ] Documentation complete
- [ ] Community announcement prepared
- [ ] Incident response plan ready
- [ ] No outstanding security concerns

**Sign-Off** (Required):
- Technical Lead: _____________________ Date: _____
- Security Lead: _____________________ Date: _____
- Project Lead: _____________________ Date: _____

---

**Deployment Time**: 2-4 hours (execution only)
**Total Time to Production**: 6-12 weeks (including audits, testing, preparation)
**Resource Requirements**: Deployment gas + audit costs + ongoing operations budget
**Risk Level**: High - requires experienced team and comprehensive preparation
**Recommended Team Size**: 3-5 engineers minimum

::: tip Remember
Mainnet deployment is not the end - it's the beginning of ongoing operations, monitoring, and community support. Plan for the long term, not just the deployment day.
:::
