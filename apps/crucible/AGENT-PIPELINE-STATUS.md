# Agent Pipeline Status

## What We Did Today (Jan 12, 2026)

### 1. Consolidated Autonomous Agent Config
- Deleted unused `WATCHER_CHARACTERS` from `characters/index.ts`
- Created single source of truth: `AUTONOMOUS_AGENTS` in `characters/index.ts`
- Simplified `server.ts` registration to a simple loop

### 2. Fixed Type Errors
- `autonomous/index.ts` - logging undefined values (use `?? null`)
- `router.ts` - removed unused `messageStore`
- `server.ts` - getContract cast, return type, turnTimeout
- `cron/index.ts` - SQLitClient config (`endpoint` not `blockProducerEndpoint`)
- `executor.ts` - bigint to string conversion for `postMessage`

### 3. Fixed Environment Variables
- Added `PRIVATE_KEY` to `apps/crucible/.env` (was only in root `.env`)
- JejuService now initializes properly

### 4. Added Cron Scheduling
- Agents can have `schedule: "0 9 * * *"` (cron pattern)
- Agent still ticks every 60s but only executes LLM when schedule matches
- `daily-digest` set to `* * * * *` (every minute) for testing

### 5. Fixed Agent Action System
- Characters updated to use `[ACTION:POST_TO_ROOM | room=... | content=...]` format
- Added `executePostToRoom` method to `CrucibleAgentRuntime`
- Actions now properly execute when LLM outputs the action format

### 6. Implemented Daily Digest Actions
Added three new actions to `CrucibleAgentRuntime`:

| Action | Purpose | Parameters |
|--------|---------|------------|
| `READ_ROOM_ALERTS` | Query messages from a room | `room`, `hours` (default 24) |
| `SEARCH_DISCUSSIONS` | Search GitHub Discussions for duplicates | `query` |
| `POST_GITHUB_DISCUSSION` | Create GitHub Discussion (fallback to room) | `title`, `body` |

**Environment Variables** (in `apps/crucible/.env`):
```bash
GITHUB_TOKEN=ghp_...           # PAT with repo scope
GITHUB_REPO_OWNER=owner        # Repository owner
GITHUB_REPO_NAME=repo          # Repository name
GITHUB_CATEGORY_ID=DIC_...     # Discussion category ID
```

**Fallback Behavior**: If GitHub credentials are missing or API fails, `POST_GITHUB_DISCUSSION` automatically posts to `infra-monitoring` room instead.

### 7. Registered Actions in Autonomous Prompt
- Added crucible actions to `getAvailableActions()` in `autonomous/index.ts`
- LLM now sees `POST_TO_ROOM`, `READ_ROOM_ALERTS`, `SEARCH_DISCUSSIONS`, `POST_GITHUB_DISCUSSION` in "## Available Actions"
- Previously LLM only saw DeFi/governance actions and used those instead

### 8. Consolidated to Single infra-monitor Agent
Replaced 3 agents (node-monitor, infra-analyzer, endpoint-prober) with single `infra-monitor`:

**New action: `GET_INFRA_STATUS`**
- Probes DWS, Crucible, Indexer, inference nodes
- Evaluates thresholds in code (not LLM)
- Returns: `{ status: 'HEALTHY'|'DEGRADED'|'CRITICAL', alerts: [...], metrics: {...} }`

**Thresholds (evaluated in code):**
- P0: Service unhealthy, unreachable, or 0 inference nodes
- P1: Latency > 5000ms
- P2: Latency > 2000ms

**LLM role (minimal):**
- Only runs if status != HEALTHY
- Formats alert message with context
- Adds recommendations
- Posts to room

**AUTONOMOUS_AGENTS simplified:**
```typescript
{
  'infra-monitor': { postToRoom: 'infra-monitoring', tickIntervalMs: 60000 },
  'daily-digest': { schedule: '0 9 * * *', watchRoom: 'infra-monitoring' },
}
```

---

## The Agent Pipeline (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                      infra-monitor                           │
│                                                              │
│  CODE: GET_INFRA_STATUS                                     │
│    - Probes DWS, Crucible, Indexer, inference               │
│    - Evaluates thresholds                                   │
│    - Returns HEALTHY/DEGRADED/CRITICAL                      │
│                                                              │
│  LLM (only if not HEALTHY):                                 │
│    - Formats alert with context                             │
│    - Adds recommendations                                   │
│    - POST_TO_ROOM                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ infra-monitoring    │
              │       room          │
              └──────────┬──────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      daily-digest                            │
│                   (scheduled: 9 AM daily)                    │
│                                                              │
│  1. READ_ROOM_ALERTS (last 24h)                             │
│  2. SEARCH_DISCUSSIONS (dedup check)                        │
│  3. POST_GITHUB_DISCUSSION                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## How Actions Work

1. **LLM generates text** with action syntax:
   ```
   [ACTION:POST_TO_ROOM | room=infra-monitoring | content=snapshot data]
   ```

2. **Runtime parses** the `[ACTION:...]` pattern

3. **Runtime executes** the action (e.g., posts to room database)

4. **Other agents** can read from the room on their next tick

---

## Files Modified

| File | Change |
|------|--------|
| `api/characters/index.ts` | Added `AUTONOMOUS_AGENTS` config, deleted `WATCHER_CHARACTERS` |
| `api/characters/node-monitor.ts` | Added `[ACTION:POST_TO_ROOM]` instructions |
| `api/characters/infra-analyzer.ts` | Added `[ACTION:POST_TO_ROOM]` instructions |
| `api/characters/endpoint-prober.ts` | Added `[ACTION:POST_TO_ROOM]` instructions |
| `api/characters/daily-digest.ts` | Added action format instructions |
| `api/sdk/eliza-runtime.ts` | Added `executePostToRoom`, `executeReadRoomAlerts`, `executeSearchDiscussions`, `executePostGithubDiscussion` |
| `api/autonomous/index.ts` | Added cron scheduling, registered crucible actions in `getAvailableActions()` |
| `api/server.ts` | Simplified agent registration |
| `apps/crucible/.env` | Added `PRIVATE_KEY` |

---

## Verification

- ✅ **Crucible typecheck passes** - All changes compile correctly
- ⚠️ Pre-existing error in `@jejunetwork/durable-objects` (unrelated to these changes)

---

## What's Next

### To Test the Pipeline:

1. **Restart crucible** to pick up changes:
   ```bash
   cd apps/crucible && bun run dev
   ```

2. **Check if agents post to rooms**:
   ```bash
   curl http://localhost:4021/api/v1/rooms/infra-monitoring/messages
   ```

3. **Watch for GitHub Discussion** (daily-digest should post when alerts exist)

### Potential Issues:

1. **LLM might not follow action format** - may need prompt tuning
2. **GitHub posting** requires proper category ID - verify in `.env`
3. **Schedule** - change `daily-digest` back to `0 9 * * *` for production

### Future Improvements:

- [ ] Add validation before action execution
- [ ] Auto-post agent responses to `postToRoom` even without explicit action
- [ ] Add retry logic for failed posts
- [ ] Dashboard to visualize agent activity and room messages
