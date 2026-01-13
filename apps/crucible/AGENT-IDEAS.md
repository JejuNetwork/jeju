# Non-LARP Agent Ideas

This document tracks agent ideas that use **real data sources** and produce **measurable outputs**.

## Anti-LARP Constraints

An agent is NOT LARP if it meets ALL of these:

| Constraint | Rule |
|------------|------|
| **Data Source** | Uses real on-chain data, indexer, or verified API (not mock/hardcoded) |
| **Measurable Output** | Produces verifiable artifacts (room messages, alerts, on-chain txs) |
| **Testable Locally** | Works on localnet without external dependencies |
| **Clear Success Criteria** | Each tick has pass/fail condition |
| **No Dead Code Paths** | If a branch can't execute, remove it |

---

## Priority Agents (Building Now)

### 1. Agent Balance Monitor

**Status**: IN PROGRESS

**Purpose**: Monitor agent vault balances, alert when running low so agents don't stop executing due to insufficient funds.

**Data Source**:
- `AgentVault.getBalance(agentId)` - real on-chain call
- `IdentityRegistry` - list of registered agents

**Logic**:
```
For each registered agent:
  balance = getVaultBalance(agentId)
  if balance < threshold:
    POST_TO_ROOM with alert
```

**Output**: POST_TO_ROOM with "Agent X vault balance low: 0.05 ETH (threshold: 0.1 ETH)"

**Thresholds**:
- WARNING: < 0.1 ETH
- CRITICAL: < 0.01 ETH

**Why Not LARP**: Real on-chain balance, real threshold evaluation, real alert

**Test Plan**:
1. Register agent with 0.05 ETH
2. Run balance monitor
3. Verify alert posted to room
4. Fund vault above threshold
5. Verify no alert on next tick

---

### 2. Agent Registration Watcher

**Status**: IN PROGRESS

**Purpose**: Announce new agent registrations, verify metadata exists, track ecosystem growth.

**Data Source**:
- Indexer GraphQL `registeredAgents` query (ordered by registeredAt DESC)
- On-chain `IdentityRegistry.getAgent(agentId)` for verification
- IPFS fetch for character metadata validation

**Logic**:
```
lastSeenAgentId = load from state
newAgents = query indexer for agents where id > lastSeenAgentId
for each newAgent:
  verify on-chain: agentExists(id)
  fetch metadata from characterCid
  POST_TO_ROOM with announcement
  update lastSeenAgentId
```

**Output**: POST_TO_ROOM with:
```
New agent registered: "AgentName" (#42)
Owner: 0x1234...5678
Tags: [defi, trading]
Character: ipfs://Qm...
```

**Why Not LARP**: Real indexer data, real on-chain verification, real IPFS metadata

**Test Plan**:
1. Note current agent count
2. Register new agent via UI or SDK
3. Run watcher
4. Verify announcement posted with correct details
5. Run again - verify no duplicate announcement

---

## Future Agents (Backlog)

### 3. Room Activity Digest

**Purpose**: Summarize message activity across rooms, identify quiet/active rooms.

**Data Source**: READ_ROOM_ALERTS from multiple rooms

**Logic**: Count messages per room over 24h, calculate activity trends

**Output**: Daily summary to digest room

**Complexity**: Low

---

### 4. Contract Event Monitor (Template)

**Purpose**: Generic event watcher - template for future specialized watchers.

**Data Source**: RPC `eth_getLogs` for specific contract events

**Logic**: Parse events, filter by criteria, format alerts

**Output**: POST_TO_ROOM with event details

**Complexity**: Medium (but most extensible)

**Use Cases**:
- Watch for large transfers
- Monitor governance proposals
- Track marketplace sales
- Alert on liquidations

---

### 5. Price Monitor

**Purpose**: Track DEX prices, alert on significant deviations.

**Data Source**: `router.getAmountsOut()` on DEX

**Logic**: Track price over time, alert if deviation > X%

**Output**: Price movement alerts

**Status**: BLOCKED - requires JEJU_SWAP_ROUTER deployment

---

### 6. Whale Alert

**Purpose**: Monitor large token transfers.

**Data Source**: Transfer events from ERC20 contracts

**Logic**: Filter transfers > threshold, identify sender/receiver

**Output**: "Whale alert: 100,000 JEJU transferred from X to Y"

**Complexity**: Medium

---

### 7. Liquidation Watcher

**Purpose**: Monitor perpetual positions approaching liquidation.

**Data Source**: PerpetualMarket contract state

**Logic**: Check margin ratios, alert when < maintenance margin

**Output**: "Position #X at risk: margin ratio 1.05x (liquidation at 1.0x)"

**Status**: BLOCKED - requires perps deployment and active positions

---

### 8. Governance Proposal Tracker

**Purpose**: Announce new proposals, track voting progress.

**Data Source**: Governance contract events

**Logic**: Watch for ProposalCreated, VoteCast events

**Output**: Proposal announcements, voting updates

**Status**: BLOCKED - requires governance deployment

---

## Removed/Deprecated

Code that was identified as LARP and removed or marked for future:

| Code | Location | Reason | Action |
|------|----------|--------|--------|
| TBD | | | |

---

## Implementation Pattern

All agents follow this pattern:

```typescript
// 1. Define character in api/characters/
export const myAgentCharacter: CharacterTemplate = {
  name: 'my-agent',
  systemPrompt: '...',
  // ...
}

// 2. Add autonomous config in api/characters/index.ts
AUTONOMOUS_AGENTS['my-agent'] = {
  postToRoom: 'my-room',
  tickIntervalMs: 60000,
  executionMode: 'code-first',
  codeFirstConfig: {
    primaryAction: 'MY_ACTION',
    llmTriggerStatuses: ['ALERT'],
    healthyTemplate: '...',
  },
}

// 3. Implement action handler in api/sdk/eliza-runtime.ts
if (upperName === 'MY_ACTION') {
  return this.executeMyAction(params)
}

private async executeMyAction(params) {
  // Real data fetch
  // Logic evaluation
  // Return structured result
}
```

---

## Data Sources Available Today

| Source | Type | Function | Status |
|--------|------|----------|--------|
| AgentVault.getBalance | On-chain | Vault balance | Ready |
| IdentityRegistry.getAgent | On-chain | Agent metadata | Ready |
| Indexer GraphQL | Off-chain | Agent search | Ready |
| Room messages | Database | READ_ROOM_ALERTS | Ready |
| Infrastructure health | API probes | GET_INFRA_STATUS | Ready |
| GitHub Discussions | External API | SEARCH_DISCUSSIONS | Ready |
| DEX prices | On-chain | getAmountsOut | Blocked (no router) |
