# New Autonomous Agent Ideas

## Context
This document captures ideas for new autonomous agents after analyzing the red/blue team architecture.
Date: 2026-01-09

## Architecture Decisions Made

### Bootstrap
- **Localnet**: Keep server.ts auto-start (convenient for dev)
- **Testnet/Mainnet**: Use cron/HTTP endpoints (scales properly)
- Remove red/blue team cron registration (unused, confusing)

### Coordination Pattern
- **Room-based coordination** for pipelines (discover → audit → label)
- **Parallel auditors** can watch same room (no race conditions)
- **Independent ticks** for standalone monitoring agents

### Post-Audit Labeling
- Security-analyst will label contracts with HIGH/CRITICAL findings
- Use `ISSUE_REPUTATION_LABEL` to mark contracts on-chain
- Check labels before auditing to skip already-reviewed contracts

---

## Cleanup TODO

### Remove
- [ ] `apps/crucible/api/characters/red-team/` (5 agents - mostly LARP)
- [ ] `apps/crucible/api/characters/blue-team/` (4 agents - redundant)
- [ ] `apps/crucible/api/characters/red-team.ts`
- [ ] `apps/crucible/api/characters/blue-team.ts`
- [ ] Red/blue team registration in `cron/index.ts`
- [ ] `loadRedTeamCharacters()` / `loadBlueTeamCharacters()` functions

### Keep
- [x] Moderation SDK/contracts (real infrastructure, useful for labeling)
- [x] Trajectory recording system (useful for training)
- [x] Archetype metadata (lightweight, good for labeling)
- [x] Coordination room pattern (working well)

### Consolidate Bootstrap
- [ ] Make server.ts auto-start conditional on `network === 'localnet'`
- [ ] Remove duplicate runner instance in cron
- [ ] Document: cron endpoints for manual testing, server.ts for dev

---

## New Agent Ideas

### 1. Infrastructure Monitors (Like Aegis)

#### Node Health Monitor
- **Purpose**: Watch DWS node health, detect outages
- **Data Sources**: `/compute/nodes/inference`, `/compute/nodes/storage`
- **Actions**:
  - `CHECK_NODE_STATS` - Query node metrics
  - `ALERT` - Post warnings to monitoring room
- **Triggers**: Independent tick (every 60s)
- **Alerts on**:
  - Node count drop > 20%
  - Latency spike > 5s
  - Error rate > 10%

#### Pool/TVL Monitor
- **Purpose**: Track liquidity pools, detect unusual flows
- **Data Sources**: Bazaar pool stats, on-chain events
- **Actions**:
  - `GET_POOL_STATS` - Query pool metrics
  - `ALERT` - Post anomaly warnings
- **Alerts on**:
  - Sudden TVL drop > 50%
  - Unusual withdrawal patterns
  - New pool with suspicious parameters

### 2. Active Security Testing (Like Cipher/Chaos)

#### Endpoint Prober
- **Purpose**: Continuously test API endpoints for vulnerabilities
- **Data Sources**: Known API routes from codebase
- **Actions**:
  - `PROBE_ENDPOINT` - Test auth bypass, injection, rate limits
  - `REPORT_VULNERABILITY` - Post findings to security room
- **Pattern**: Independent tick, cycles through endpoint list
- **Tests**:
  - Auth bypass (missing auth headers)
  - SQL/NoSQL injection
  - Rate limit enforcement
  - CORS misconfiguration

#### Contract Fuzzer
- **Purpose**: Fuzz-test deployed contracts with edge cases
- **Data Sources**: Verified contracts from Blockscout
- **Actions**:
  - `FUZZ_CONTRACT` - Send edge case inputs
  - `REPORT_CRASH` - Document failures
- **Pattern**: Room coordination (receives contracts from watcher)
- **Tests**:
  - MAX_UINT256 inputs
  - Zero amounts
  - Reentrancy probes
  - Gas limit attacks

### 3. Parallel Auditor Expansion

#### Gas Auditor
- **Purpose**: Analyze contracts for gas optimization
- **Watches**: `base-contract-reviews` room (same as security-analyst)
- **Output**: `[GAS_AUDIT | contract=0x...]` messages
- **Focus**:
  - Storage optimization
  - Loop efficiency
  - Unnecessary operations

#### Compliance Auditor
- **Purpose**: Check ERC standard compliance
- **Watches**: `base-contract-reviews` room
- **Output**: `[COMPLIANCE_AUDIT | contract=0x...]` messages
- **Focus**:
  - ERC-20/721/1155 interface compliance
  - Standard event emissions
  - Required function signatures

#### Audit Aggregator (Optional)
- **Purpose**: Combine results from all auditors
- **Watches**: `base-contract-reviews` room
- **Waits for**: Security + Gas + Compliance audits
- **Output**: `[COMBINED_AUDIT | contract=0x...]` with overall risk score

### 4. Cross-Chain Watchers

#### Ethereum Mainnet Watcher
- **Purpose**: Monitor relevant events on Ethereum L1
- **Data Sources**: Etherscan API, Alchemy
- **Watches for**:
  - Bridge deposits/withdrawals
  - Governance proposals affecting Jeju
  - Major protocol updates

#### Arbitrum/Optimism Watcher
- **Purpose**: Monitor L2 ecosystem for patterns
- **Data Sources**: Respective block explorers
- **Posts to**: Cross-chain coordination room

---

## Implementation Priority

### Phase 1 (Quick Wins)
1. Add `ISSUE_REPUTATION_LABEL` to security-analyst post-audit
2. Add label checking before audit (skip already-labeled)
3. Clean up red/blue team code

### Phase 2 (New Agents)
4. Node Health Monitor (simple, high value)
5. Contract Fuzzer (extends security-analyst capability)

### Phase 3 (Advanced)
6. Parallel auditor expansion (gas, compliance)
7. Cross-chain watchers (requires API integrations)
8. Endpoint prober (needs careful scoping)

---

## Message Format Recommendations

For parallel auditors to coordinate, use structured message format:

**Input (from watcher):**
```
[CONTRACT_DISCOVERED | address=0x... | network=base | verified=true]
Name: TokenVault
Source: https://base.blockscout.com/address/0x...
```

**Output (from each auditor):**
```
[SECURITY_AUDIT | contract=0x...]
Status: COMPLETE
Risk Level: HIGH
Findings: ...

[GAS_AUDIT | contract=0x...]
Status: COMPLETE
Efficiency: 72/100
Optimizations: ...
```

This enables:
- Easy parsing with regex
- Filtering by audit type
- Grouping by contract address
