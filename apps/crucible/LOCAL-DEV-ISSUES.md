# Local Development Issues

Issues discovered during debugging that cause services to not work properly after `bun run dev`.

## Key Concepts: Characters vs Deployed Agents

**Important distinction that causes confusion:**

| Concept | Character Templates | Deployed Agents |
|---------|---------------------|-----------------|
| **What** | In-memory personas for chat | On-chain registered identities |
| **Where** | `/api/v1/chat/characters` | `/api/v1/search/agents` |
| **UI** | Chat page sidebar (Jimmy, Eli5, etc.) | Agents page, Room "Add Agent" |
| **Storage** | Memory only (lost on restart) | Blockchain + IPFS (persistent) |
| **Cost** | Free | Gas for registration |
| **Creation** | Auto-seeded on startup | Explicit via "Deploy Agent" |

**Character Templates** (`apps/crucible/api/characters/`):
- 15+ predefined personas (project-manager, red-team, blue-team, etc.)
- Created in-memory via `runtimeManager.createRuntime()`
- Green dot = has active runtime, can chat immediately
- No on-chain footprint

**Deployed Agents** (on-chain):
- Registered to IdentityRegistry contract
- Have an agentId (bigint), vault, character CID, state CID
- Indexed by the indexer, appear in search results
- Persistent across restarts

**To deploy a character as an on-chain agent:**
1. Go to `/agents/new` or use API `POST /api/v1/agents`
2. Select a character template
3. This calls `agentSdk.registerAgent()` which:
   - Stores character to IPFS
   - Registers on IdentityRegistry contract
   - Creates a vault for the agent

## Issue 1: Indexer Not Started by `bun run dev`

**Status**: RESOLVED

The indexer exclusion was removed. Indexer now starts automatically with `bun run dev`.

## Issue 2: Contract Address Config Can Be Stale

**Location**: `packages/config/contracts.json` vs deployment files

After a fresh `bun run dev`, contract addresses in `packages/config/contracts.json` may not match the actually deployed contracts.

**Status**: Auto-sync added after bootstrap.

## Issue 3: "READY" Screen Hides Service Failures

When `bun run dev` completes, it shows a "READY" screen that clears all previous logs (`console.clear()` at line 541 in dev.ts). This hides:
- Services that failed to start
- Configuration errors
- Missing dependencies

**Impact**: User sees "READY" but services may not be running properly.

**Status**: Fixed - now shows failed services before READY.

## Issue 4: OAuth3 JNS Resolver Contract Error

**Status**: RESOLVED (not applicable on localnet)

This error only occurs on **testnet** URLs (`*.testnet.jejunetwork.org`). On localnet (`*.local.jejunetwork.org` or `localhost`), decentralized mode is disabled (`decentralized: false`) so JNS resolution is skipped entirely.

**Solution**: Use the correct URL for your environment.

## Issue 5: Invalid Wallet Login Session Capabilities

**Status**: RESOLVED (not applicable on localnet)

Same as Issue 4 - this was caused by accessing testnet URL instead of localnet. On localnet, OAuth3 runs in centralized/simulated mode and doesn't hit these validation issues.

## Current Session Progress

### Completed
- Room page separation from 1:1 chat
- User identity using `useJejuAuth()` instead of hardcoded values
- `createRoom()` now persists stateCid on-chain
- `postMessage()` accepts string agentId (wallet addresses)
- Add Agent dropdown in Room page (ready for working indexer)
- Documentation of local dev issues

### Pending
- OAuth3/JNS resolver contract mismatch
- Wallet login capabilities validation error
- Indexer now running but auth is broken

## Issue 6: Agent Deployment Timeout

**Status**: RESOLVED

**Symptom**: `POST /api/v1/agents` times out with "The operation timed out" error.

**Root Cause**: Multiple missing timeouts in the agent registration flow:

1. **DWS Storage Upload** (`apps/crucible/api/sdk/storage.ts`)
   - `fetch()` calls had no timeout
   - If DWS `/storage/upload` hung, request hung forever

2. **waitForTransactionReceipt** (`apps/crucible/api/sdk/agent.ts`)
   - Viem's `waitForTransactionReceipt()` has no timeout by default
   - Would wait forever for tx to be mined

3. **IPFS Connection Issue**
   - Direct IPFS uploads return data but don't close connection properly
   - curl shows exit code 28 (timeout) even when CID is returned
   - Suggests IPFS keep-alive or chunked transfer issue

**Fix Applied**:
- Added `AbortSignal.timeout()` to all fetch calls in `storage.ts`:
  - Upload: 30s timeout
  - Download: 30s timeout
  - HEAD requests: 5s timeout
- Added `timeout` parameter to all `waitForTransactionReceipt()` calls in `agent.ts`:
  - 60s timeout for all transaction receipts

**Workaround** (if IPFS itself is unhealthy):
```bash
docker restart jeju-ipfs
curl -s http://127.0.0.1:5001/api/v0/id  # Should respond quickly
```

## Issue 7: Agent Proliferation on Restart

**Status**: RESOLVED

**Symptom**: Database shows 80+ agents and growing, even though you only manually deployed a few.

**Root Cause**: `BotInitializer.initializeDefaultBots()` in `apps/crucible/api/bots/initializer.ts` was registering 6 trading bots on-chain **every time the server starts** with NO deduplication check.

**Fix Applied**: Added an existence check before bot initialization (mirrors bootstrap pattern):
```typescript
// Check if any agents already exist (indicates prior initialization)
const existingAgent = await this.config.agentSdk.getAgent(1n)
if (existingAgent) {
  log.info('Agents already exist on chain, skipping bot initialization')
  return this.bots
}
```

**How it works**:
- Fresh chain → agent 1 doesn't exist → bots get registered
- After bots registered → agent 1 exists → skip registration
- Chain reset → agent 1 gone → bots get registered again

**To clean up existing duplicates** (if you had this issue before the fix):
```bash
# Best option: restart localnet fresh with `bun run dev` (resets chain)
```

## Issue 8: AI Inference Fails - "No inference nodes available"

**Status**: RESOLVED

**Symptom**: When executing an AI agent via `/api/v1/execute`, got error:
```
DWS inference failed (network: localnet): Unable to connect
```
Or from DWS directly:
```
{ "error": "No inference nodes available" }
```

### Root Cause

The CLI inference server (port 4100) was started by `jeju dev` but never registered with DWS. When crucible called DWS at `/compute/chat/completions`, DWS had no inference nodes to route to.

### Fix Applied

Added inference node registration in `packages/cli/src/commands/dev.ts` (lines 250-281).

After DWS health check succeeds, the CLI inference server is now automatically registered:
```typescript
// Register CLI inference server with DWS
const inferenceHost = getLocalhostHost()
const inferenceEndpoint = `http://${inferenceHost}:4100`
await fetch('http://127.0.0.1:4030/compute/nodes/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: 'cli-inference-node',
    endpoint: inferenceEndpoint,
    capabilities: ['inference'],
    models: ['*'],
    provider: 'cli-multi-provider',
    region: 'local',
    maxConcurrent: 100,
  }),
})
```

### Verification

```bash
# After `bun run dev`, check if inference works
curl -s "http://127.0.0.1:4030/compute/chat/completions" \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}],"model":"gpt-4o-mini"}'

# Should return AI response, not "No inference nodes available"
```

### Legacy Workaround (No Longer Needed)

The manual script `bun run apps/crucible/scripts/local-inference-node.ts` is no longer required for basic inference. It can still be used if you need a separate inference node on port 4032.

## Issue 9: Room Agents Don't Auto-Respond to Messages

**Status**: BY DESIGN - FEATURE NEEDED

**Symptom**: Added agents to a room, sent a message, but agents don't reply.

### Root Cause

There is **no room message trigger mechanism**. When you post a message:
1. Message is stored in room state (IPFS)
2. Frontend polls every 5 seconds to display new messages
3. **No agent is notified to respond**

### Key Distinction: Autonomous Mode vs Room Responses

| Feature | What It Does | What It Doesn't Do |
|---------|--------------|-------------------|
| Autonomous Mode | Agents tick on a schedule (e.g., every 60s) | React to room messages |
| Room Messages | Store/retrieve messages | Trigger agent execution |

Even with `AUTONOMOUS_ENABLED=true`, autonomous agents:
- Run periodic ticks based on their config
- Execute actions based on LLM decisions
- Do NOT automatically respond to room messages

### Relevant Files

- `apps/crucible/api/server.ts` - `POST /api/v1/rooms/:roomId/message` (stores message, no trigger)
- `apps/crucible/api/sdk/room.ts` - `postMessage()` stores to IPFS only
- `apps/crucible/api/autonomous/index.ts` - scheduled ticks, not event-driven
- `apps/crucible/api/sdk/executor.ts` - `/api/v1/execute` endpoint (manual trigger)

### Current Workaround

Manually trigger agent execution after posting a message:
```bash
curl -X POST "http://127.0.0.1:4021/api/v1/execute" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"99","input":{"message":"hi there","roomId":"4"}}'
```

### Feature Needed

Add a room message trigger that:
1. Fires when a message is posted to a room
2. Identifies participant agents that should respond
3. Calls `/api/v1/execute` for each agent with room context

### Bot Types Matter

When using `/api/v1/execute`, the agent's `botType` affects behavior:

| botType | Execution Path | Posts to Room? |
|---------|---------------|----------------|
| `ai_agent` | Full LLM inference | Yes (if roomId provided) |
| `trading_bot` | Hardcoded status response | No |
| `org_tool` | LLM with org context | Varies |

If your agent is a `trading_bot`, it won't use LLM or post to rooms.

## Quick Debug Commands

```bash
# Check what's running
lsof -i :4350  # GraphQL
lsof -i :4352  # REST API
lsof -i :4021  # Crucible API
lsof -i :6546  # Anvil chain

# Check if agents are indexed
curl -s "http://localhost:4350/graphql" -d '{"query":"{ registeredAgents { id } }"}'

# Check agent directly from chain
curl -s "http://127.0.0.1:4021/api/v1/agents/14" | jq .

# Start missing indexer services
cd apps/indexer
bun run db:up && bun run dev:full
```
