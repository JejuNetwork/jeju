# PRD: Cleanup Red/Blue Team Architecture

## Overview

Remove the unused red/blue team agent infrastructure from Crucible and consolidate the dual runner pattern. This code was designed for adversarial security testing but is largely placeholder (LARP) and adds complexity without value. The working watcher→auditor pattern should be preserved and enhanced.

---

## Background

### Why Two Runner Instances Exist (Historical Context)

The codebase has two separate `AutonomousAgentRunner` instances:

| Instance | Location | Original Purpose | Current State |
|----------|----------|------------------|---------------|
| `autonomousRunner` | server.ts:1671 | Real-time agent execution with intervals | **Working** - runs watcher + analyst |
| `agentRunner` | cron/index.ts:78 | Training data collection from full teams | **Orphaned** - no scheduler triggers it |

**Why this happened**: Divergent development paths:
1. Server.ts bootstrap was built for "make agents work in dev"
2. Cron bootstrap was built for "collect training data from full team"

**The problem**:
- They use the **same factory** (`createAgentRunner`) but create **independent instances**
- Cron has trajectory DB persistence that server.ts lacks
- Cron registers 11 agents, server.ts registers 2
- **No production scheduler exists** - Terraform has no CronJob, so cron endpoints are orphaned
- If both run simultaneously, they'd register duplicate agents

### Red/Blue Team Analysis

**Red Team (Phoenix + 4 others) = 100% LARP**
- Actions like `SIMULATE_ATTACK`, `PROBE`, `REPORT_VULNERABILITY` have **zero handlers**
- Purely conversational role-play with no actual security testing capability

**Blue Team (Shield + 3 others) = Mixed Real/LARP**
- **Real actions**: `ISSUE_REPUTATION_LABEL`, `CREATE_MODERATION_CASE`, `SCAN_CONTRACT` (handlers exist)
- **LARP actions**: `DEFEND`, `IMPLEMENT_CONTROL`, `ACKNOWLEDGE` (no handlers)
- `contracts-auditor` duplicates `security-analyst` functionality

**Moderation SDK** = Real infrastructure worth keeping
- `packages/eliza-plugin/src/actions/moderation-full.ts` has 14 working actions
- On-chain integration with ReputationLabelManager, ModerationMarketplace contracts

### Archetype System Analysis

**Where archetypes are used:**
1. **Prompt injection** (autonomous/index.ts:907-925) - adds role objectives to agent prompts
2. **Trajectory recording** - labels training data by archetype
3. **LLM judge scoring** - different rubrics per archetype

**What's real vs LARP:**
- `blue-team`/`red-team` prompt injection = real (shapes behavior)
- `watcher` archetype = LARP (set but never used in prompts)
- Training archetypes (`trader`, `degen`) = separate system, not used in Crucible

---

## Scope

### Files to DELETE

```
apps/crucible/api/characters/red-team/
├── scammer.ts
├── security-researcher.ts
├── contracts-expert.ts
├── fuzz-tester.ts
└── index.ts

apps/crucible/api/characters/blue-team/
├── network-guardian.ts
├── contracts-auditor.ts
└── index.ts

apps/crucible/api/characters/red-team.ts
apps/crucible/api/characters/blue-team.ts
```

### Files to KEEP (from blue-team)

```
apps/crucible/api/characters/blue-team/moderator.ts  # Move to characters/ root
```

The moderator character has real moderation capabilities and should be preserved for future use.

### Files to MODIFY

#### 1. `apps/crucible/api/characters/index.ts`

**Remove:**
- `RED_TEAM_CHARACTERS` constant
- `BLUE_TEAM_CHARACTERS` constant
- `loadRedTeamCharacters()` function
- `loadBlueTeamCharacters()` function
- Imports from red-team and blue-team directories/files
- Character entries: `red-team`, `scammer`, `security-researcher`, `contracts-expert`, `fuzz-tester`, `blue-team`, `network-guardian`, `contracts-auditor`

**Keep:**
- `WATCHER_CHARACTERS` constant
- `loadWatcherCharacters()` function
- Character exports for: `base-watcher`, `security-analyst`, `moderator` (moved), and general characters

**Add:**
- Import for moved `moderator.ts`
- `moderator` entry in characters record

#### 2. `apps/crucible/api/cron/index.ts`

**Major change**: Remove separate runner, share with server.ts

**Remove:**
- Local `agentRunner` singleton (line 78)
- `getAgentRunner()` function with all agent registration
- `loadBlueTeamCharacters` and `loadRedTeamCharacters` imports
- Blue team registration loop (lines ~150-162)
- Red team registration loop (lines ~181-193)
- Security-analyst duplicate registration (lines ~165-178)
- Watcher registration (lines ~196-209) - handled by server.ts

**Keep:**
- `COORDINATION_ROOMS` constant
- `ensureCoordinationRoom()` function
- Cron route handlers (but modify to use shared runner)
- Trajectory storage and DB persistence logic

**Modify:**
- Import shared runner from server.ts
- `/agent-tick` endpoint calls shared runner's `executeAllAgentsTick()`

#### 3. `apps/crucible/api/autonomous/index.ts`

**Remove (lines ~907-925):**
```typescript
// Remove CONTENT but keep structure for future archetypes:
if (config.archetype === 'blue-team') {
  parts.push('## Objective: Blue Team Defense')
  // ... all blue-team specific content
}
else if (config.archetype === 'red-team') {
  parts.push('## Objective: Red Team Testing')
  // ... all red-team specific content
}
```

**Keep:**
- The if/else structure (empty, ready for future archetypes like `watcher`, `auditor`)
- Archetype field in `ExtendedAgentConfig` type
- Trajectory recording with archetype metadata
- All room coordination logic

#### 4. `apps/crucible/api/server.ts`

**Modify:**
- Export `autonomousRunner` for cron to import
- Add trajectory DB persistence (move from cron)
- Remove commented-out agent references (lines 1691-1695, 1749-1751)

**Keep:**
- Auto-registration of `base-watcher` and `security-analyst`
- Room coordination setup
- All `/api/v1/autonomous/*` endpoints

---

## Implementation Order

### Phase 1: Preserve Moderator Character
1. Copy `apps/crucible/api/characters/blue-team/moderator.ts` to `apps/crucible/api/characters/moderator.ts`
2. Update imports in the new file if needed

### Phase 2: Delete Red/Blue Team Files
1. Delete `apps/crucible/api/characters/red-team/` directory (5 files)
2. Delete `apps/crucible/api/characters/blue-team/` directory (4 files including original moderator)
3. Delete `apps/crucible/api/characters/red-team.ts`
4. Delete `apps/crucible/api/characters/blue-team.ts`

### Phase 3: Update Character Index
1. Remove deleted file imports
2. Add import for new `moderator.ts` location
3. Remove team constants and load functions
4. Update `characters` record (remove 9 entries, keep moderator)
5. Remove team-related exports

### Phase 4: Consolidate Runner (server.ts)
1. Export `autonomousRunner` instance
2. Add trajectory DB persistence callback from cron
3. Clean up commented agent references

### Phase 5: Simplify Cron Routes
1. Remove local `agentRunner` singleton
2. Import shared runner from server.ts
3. Remove all agent registration code
4. Update endpoints to use shared runner
5. Keep trajectory flush and health check logic

### Phase 6: Clean Archetype Prompts
1. Remove blue-team prompt content (keep empty if block)
2. Remove red-team prompt content (keep empty else-if block)
3. Add comment: `// Reserved for future archetype-specific prompts`

### Phase 7: Verify & Test
1. Run `bun run typecheck` in apps/crucible
2. Run `bun run build` in apps/crucible
3. Test: `AUTONOMOUS_ENABLED=true bun run dev`
4. Verify watcher→auditor flow works
5. Test: `curl -X POST localhost:4021/api/cron/agent-tick`

---

## Verification Steps

### Before Cleanup
```bash
cd apps/crucible
bun run typecheck  # Note current errors
git status         # Confirm clean state
```

### After Cleanup
```bash
# Build verification
bun run typecheck  # Should pass or have same errors
bun run build      # Must succeed

# Functional verification
AUTONOMOUS_ENABLED=true bun run dev

# Watch logs for:
# - "Auto-registered autonomous agent" for base-watcher, security-analyst
# - "Polling Blockscout for verified contracts"
# - "Audit request received" when contracts found
# - Messages in base-contract-reviews room

# Cron endpoint verification
curl -X POST http://localhost:4021/api/cron/agent-tick
# Should return: { executed: 2, succeeded: 2, ... }
# Only watcher + analyst, NOT 11 agents
```

---

## Success Criteria

- [ ] No `red-team/` or `blue-team/` directories exist
- [ ] `moderator.ts` preserved at `characters/moderator.ts`
- [ ] Single runner instance (not two)
- [ ] `bun run typecheck` passes
- [ ] `bun run build` succeeds
- [ ] Autonomous watcher→auditor flow works
- [ ] Cron endpoints use shared runner
- [ ] `/api/cron/agent-tick` returns 2 agents (not 11)
- [ ] Room coordination still functions
- [ ] Moderation SDK actions still available
- [ ] Archetype mechanism preserved (empty, ready for future use)

---

## Rollback Plan

If issues arise:
```bash
git checkout HEAD -- apps/crucible/api/characters/
git checkout HEAD -- apps/crucible/api/cron/index.ts
git checkout HEAD -- apps/crucible/api/autonomous/index.ts
git checkout HEAD -- apps/crucible/api/server.ts
```

---

## Follow-up Tasks (Out of Scope)

These are tracked separately, not part of this cleanup:

1. **Add ISSUE_REPUTATION_LABEL to security-analyst**
   - After HIGH/CRITICAL audit findings, call `ISSUE_REPUTATION_LABEL`
   - Mark risky contracts on-chain for network protection

2. **Add archetype prompts for watcher/auditor**
   - Use the preserved if/else structure
   - Give watcher "discovery" objectives
   - Give auditor "security analysis" objectives

3. **New agent implementations**
   - See `NEW-AGENT-IDEAS.md` for infrastructure monitors, fuzzer, etc.

4. **Moderation agent activation**
   - Configure moderator character with room coordination
   - Integrate with ModerationMarketplace contract

---

## Technical Details

### Runner Consolidation Pattern

**Before (two runners):**
```typescript
// server.ts
let autonomousRunner: AutonomousAgentRunner | null = null
// Creates own instance, registers 2 agents

// cron/index.ts
let agentRunner: AutonomousAgentRunner | null = null
// Creates own instance, registers 11 agents
```

**After (shared runner):**
```typescript
// server.ts
export let autonomousRunner: AutonomousAgentRunner | null = null
// Single instance, registers 2 agents, has trajectory persistence

// cron/index.ts
import { autonomousRunner } from '../server'
// Uses shared instance, no registration, just triggers ticks
```

### Files Changed Summary

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `characters/red-team/` | DELETE | -500 |
| `characters/blue-team/` | DELETE | -400 |
| `characters/red-team.ts` | DELETE | -100 |
| `characters/blue-team.ts` | DELETE | -100 |
| `characters/moderator.ts` | CREATE (move) | +150 |
| `characters/index.ts` | MODIFY | -50 |
| `cron/index.ts` | MODIFY | -100 |
| `autonomous/index.ts` | MODIFY | -20 |
| `server.ts` | MODIFY | +20 |

**Net reduction: ~1,100 lines**

---

## Related Documents

- `apps/crucible/NEW-AGENT-IDEAS.md` - Ideas for new agents after cleanup
- `packages/eliza-plugin/src/actions/moderation-full.ts` - Moderation actions (keep)
- `packages/eliza-plugin/src/actions/audit-contract.ts` - Audit action (keep)
- `packages/eliza-plugin/src/actions/blockscout.ts` - Discovery action (keep)
