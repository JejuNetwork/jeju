# PRD: Registration Watcher Agent (MVP)

## Overview

**Goal**: Announce new agent registrations to track ecosystem growth.

**Scope**: Single agent that monitors the indexer for new registrations and posts announcements to the `infra-monitoring` room.

## What It Does

Every 2 minutes:
1. Query indexer for agents registered since last tick
2. For each new agent, fetch metadata from IPFS (with 5s timeout)
3. Post announcement to `infra-monitoring` room
4. If no new agents, post compact status line

## Data Flow

```
Indexer GraphQL ──→ Filter by registeredAt ──→ Fetch IPFS metadata ──→ POST_TO_ROOM
     │                                              │
     │                                              └── Timeout? Use "Agent #N"
     │
     └── Query: registeredAgents(orderBy: registeredAt_DESC, limit: 20)
```

## Technical Spec

### Action: CHECK_NEW_REGISTRATIONS

**Input Parameters:**
- `lastSeenId` (optional): Highest agent ID seen in previous tick

**Output:**
```typescript
{
  status: 'NEW_REGISTRATIONS' | 'NO_NEW',
  newAgents: Array<{
    agentId: string
    name: string
    description: string
    tags: string[]
    owner: string
    registeredAt: string
  }>,
  summary: {
    newCount: number
    lastSeenId: string
    highestId: string  // Pass this as lastSeenId in next tick
  }
}
```

### Output Format

**New registrations:**
```
[AGENT_REGISTERED | t=1704812345 | count=1]

New agent: "SecurityBot" (#42)
- Owner: 0x1234...5678
- Tags: security, auditor
- Description: Autonomous security monitoring agent
```

**No new registrations:**
```
[REGISTRATION_CHECK | t=1704812345] No new registrations
```

### Autonomous Config

```typescript
{
  agentId: 'registration-watcher',
  tickIntervalMs: 120000, // 2 minutes
  executionMode: 'code-first',
  postToRoom: 'infra-monitoring',
  codeFirstConfig: {
    primaryAction: 'CHECK_NEW_REGISTRATIONS',
    llmTriggerStatuses: [], // Fully deterministic - no LLM needed
    healthyTemplate: '[REGISTRATION_CHECK | t={timestamp}] No new registrations',
  },
}
```

## State Management

**Problem**: Need to track which agents we've already announced.

**Solution**: Use `lastSeenId` watermark (highest agentId seen).
- First tick: Query current highest ID, set as baseline, don't announce existing agents
- Subsequent ticks: Announce agents with ID > lastSeenId
- On restart: Re-baseline (may miss agents registered during downtime - acceptable for MVP)

**Implementation**: The autonomous runner passes `previousTick` timestamp. We can use either:
1. Agent ID watermark (simpler, recommended)
2. Timestamp filtering (depends on indexer timestamp accuracy)

## Files to Create/Modify

1. **NEW**: `api/characters/registration-watcher.ts` - Character template
2. **MODIFY**: `api/characters/index.ts` - Export character, add to AUTONOMOUS_AGENTS
3. **MODIFY**: `api/sdk/eliza-runtime.ts` - Add CHECK_NEW_REGISTRATIONS action handler

## Test Plan

### Localnet Testing

1. Start localnet: `bun run dev --minimal`
2. Start indexer: `cd apps/indexer && bun run dev:full`
3. Start crucible with autonomous: `AUTONOMOUS_ENABLED=true bun run dev` (in apps/crucible)
4. Wait for first tick - should see "No new registrations" in infra-monitoring room
5. Register new agent via UI or API
6. Wait for next tick - should see announcement

### Verify Success

```bash
# Check room messages
curl -s localhost:4021/api/v1/rooms/infra-monitoring/messages | jq '.[-5:]'

# Should see messages like:
# [REGISTRATION_CHECK | t=...] No new registrations
# [AGENT_REGISTERED | t=... | count=1] New agent: "TestAgent" (#1)
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Indexer unavailable | Log error, skip tick, retry next interval |
| IPFS metadata timeout | Use fallback name "Agent #N" |
| No agents exist | Post "No new registrations" |
| Agent restart | Re-baseline, may announce recent agents again (acceptable) |

## Success Criteria

- [ ] Agent ticks every 2 minutes
- [ ] New registrations are announced within 1 tick (2 min) of indexer update
- [ ] Announcements include name, owner, tags (when available)
- [ ] No duplicate announcements for same agent (within session)
- [ ] Graceful handling of indexer/IPFS failures

## Future Enhancements (Not MVP)

- Persist lastSeenId to database (survive restarts)
- On-chain verification of registration
- Include vault balance in announcement
- Webhook/notification integrations
