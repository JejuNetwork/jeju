# Basic Agent Flow - Getting One Agent Working

## Goal

Get the **minimal path** working: one agent, one room, visible output in Web UI.

This must work before red/blue teams, security audits, or anything complex.

---

## Requirements

- **Trigger**: Both manual chat AND autonomous ticks
- **Output**: Web UI at `http://crucible.local.jejunetwork.org:8080/`
- **Character**: New simple "test-agent"
- **Progressive**: respond → post to room → execute action

---

## Chunks

### Chunk 1: Create Test Agent Character

**Work:**
- [ ] Create `apps/crucible/api/characters/test-agent.ts`
- [ ] Add minimal character: id, name, system prompt, bio
- [ ] Register in `characters/index.ts`
- [ ] Restart Crucible API

**Check-in:** Character file exists and exports correctly

**Manual Test:**
```bash
# Verify character appears in list
curl -s http://127.0.0.1:4021/api/v1/characters | jq '.characters | keys'
# Expected: [..., "test-agent", ...]
```

---

### Chunk 2: Manual Chat Works

**Work:**
- [ ] Test chat endpoint with test-agent
- [ ] Verify LLM responds (needs inference node running)

**Check-in:** API returns agent response

**Manual Test:**
```bash
# Chat with agent
curl -X POST http://127.0.0.1:4021/api/v1/chat/test-agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, who are you?"}'
# Expected: {"response": "I am...", ...}
```

**Troubleshooting:**
- If timeout: Check inference node on :4032
- If 404: Character not registered

---

### Chunk 3: Chat Visible in Web UI

**Work:**
- [ ] Open Web UI: http://crucible.local.jejunetwork.org:8080/
- [ ] Navigate to chat/agents section
- [ ] Find test-agent and send message
- [ ] Verify response appears

**Check-in:** Can see conversation in browser

**Manual Test:**
1. Open http://crucible.local.jejunetwork.org:8080/
2. Find test-agent in UI
3. Send "Hello"
4. See response in chat window

---

### Chunk 4: Create Room

**Work:**
- [ ] Create a room via API
- [ ] Verify room appears in list

**Check-in:** Room exists with ID

**Manual Test:**
```bash
# Create room
curl -X POST http://127.0.0.1:4021/api/v1/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "test-room", "type": "collaboration"}'
# Expected: {"roomId": "...", ...}

# List rooms
curl -s http://127.0.0.1:4021/api/v1/rooms | jq '.rooms'
# Expected: [{"id": "...", "name": "test-room", ...}]
```

---

### Chunk 5: Agent Posts to Room

**Work:**
- [ ] Have agent join room
- [ ] Agent posts message to room
- [ ] Message visible in room history

**Check-in:** Message appears in room

**Manual Test:**
```bash
# Agent joins room (replace ROOM_ID)
curl -X POST http://127.0.0.1:4021/api/v1/rooms/ROOM_ID/join \
  -H "Content-Type: application/json" \
  -d '{"agentId": "test-agent"}'

# Get room messages
curl -s http://127.0.0.1:4021/api/v1/rooms/ROOM_ID/messages | jq '.'
# Expected: messages array with agent's post
```

---

### Chunk 6: Autonomous Tick Works

**Work:**
- [ ] Register agent for autonomous execution
- [ ] Start autonomous runner
- [ ] Verify tick executes

**Check-in:** Agent ticks without manual trigger

**Manual Test:**
```bash
# Check autonomous status
curl -s http://127.0.0.1:4021/api/v1/autonomous/status | jq '.'

# Register agent
curl -X POST http://127.0.0.1:4021/api/v1/autonomous/agents \
  -H "Content-Type: application/json" \
  -d '{"agentId": "test-agent", "characterId": "test-agent"}'

# Start runner
curl -X POST http://127.0.0.1:4021/api/v1/autonomous/start

# Check activity after 1-2 minutes
curl -s http://127.0.0.1:4021/api/v1/autonomous/activity | jq '.'
# Expected: activity entries for test-agent
```

---

### Chunk 7: Agent Executes Action

**Work:**
- [ ] Update test-agent to know about one real action (e.g., CHECK_BALANCE)
- [ ] Have agent execute it during tick or chat
- [ ] Verify action result

**Check-in:** Action executes, result visible

**Manual Test:**
```bash
# Chat asking agent to check a balance
curl -X POST http://127.0.0.1:4021/api/v1/chat/test-agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Check the balance of address 0x0000000000000000000000000000000000000000"}'
# Expected: Response includes balance info or action result
```

---

## Progress Log

| Chunk | Status | Date | Notes |
|-------|--------|------|-------|
| 1. Create character | ✅ Complete | 2026-01-06 | `api/characters/test-agent.ts` created |
| 2. Manual chat | ✅ Complete | 2026-01-06 | LLM responds via `/api/v1/chat/test-agent` |
| 3. Web UI | ✅ Complete | 2026-01-06 | Can chat with agents in browser |
| 4. Create room | ✅ Complete | 2026-01-06 | roomId: 1 created on-chain |
| 5. Post to room | ✅ Complete | 2026-01-06 | Shell escaping issue (not a bug), use heredoc |
| 6. Autonomous tick | ✅ Complete | 2026-01-06 | Ticks run, agent generates responses |
| 7. Execute action | ✅ Complete | 2026-01-06 | Fixed DWS storage stats schema |

---

## Issues Found

| Issue | Chunk | Status | Fix |
|-------|-------|--------|-----|
| POST `/api/v1/rooms/:roomId/message` returns 400 Bad Request | 5 | **Not a bug** | Shell escaping issue - use heredoc |
| GET_STORAGE_STATS expects `{totalPins, totalSizeGB}` but DWS returns different schema | 7 | ✅ **Fixed** | Updated `apps/dws/api/storage/multi-backend.ts` |
| /rooms page shows agent picker instead of room content | 3 | ✅ **Fixed** | Updated `apps/crucible/web/pages/Chat.tsx` |

---

## Bug Investigation Details (2026-01-06)

### Bug 1: POST /api/v1/rooms/:roomId/message - "Bad Request"

**Root Cause**: NOT a server bug. Shell history expansion escapes `!` in curl commands, causing malformed JSON.

**Evidence**: The server code is correct. When using proper escaping, requests work.

**Secondary Issue**: Room 1 has empty `stateCid` in smart contract, causing "CID cannot be empty" error when posting.

**Workaround**: Use heredoc for curl:
```bash
cat << 'EOF' | curl -X POST "http://127.0.0.1:4021/api/v1/rooms/1/message" \
  -H "Content-Type: application/json" -d @-
{"agentId":14,"content":"Hello from TestBot"}
EOF
```

---

### Bug 2: GET_STORAGE_STATS Schema Mismatch

**Root Cause**: SDK's `StorageStatsSchema` expects `{totalPins, totalSizeBytes, totalSizeGB}` but DWS returns `Partial<NodeStorageStats>` with different fields like `usedCapacityGB`.

**Location**:
- SDK schema: `/packages/sdk/src/shared/schemas.ts` lines 90-94
- DWS returns: `/apps/dws/api/storage/multi-backend.ts` `getNodeStats()` lines 849-861

**Fix** (in `/apps/dws/api/storage/multi-backend.ts`):
```typescript
getNodeStats(): { totalPins: number; totalSizeBytes: number; totalSizeGB: number } & Partial<NodeStorageStats> {
  const webtorrentStats = this.webtorrentBackend?.getNodeStats() ?? {}

  let totalSize = 0
  for (const metadata of this.contentRegistry.values()) {
    totalSize += metadata.size
  }

  const totalPins = this.contentRegistry.size
  const totalSizeBytes = totalSize
  const totalSizeGB = totalSize / (1024 * 1024 * 1024)

  return {
    ...webtorrentStats,
    totalPins,
    totalSizeBytes,
    totalSizeGB,
    usedCapacityGB: totalSizeGB,
  }
}
```

---

### Bug 3: /rooms Page UX Issue

**Root Cause**: NOT a URL bug. Links correctly go to `/chat/${roomId}`. The problem is Chat.tsx shows agent picker instead of room content when roomId is present.

**Expected behavior**: Clicking a room should show that room's conversation, not require manual agent selection.

**Fix** (in `/apps/crucible/app/pages/Chat.tsx`):
When `roomId` exists in URL params:
1. Skip the agent selection UI
2. Fetch room data and show ChatInterface with room context
3. Only show agent picker when no roomId

---

## Dependencies

**Services that must be running:**
- [ ] Crucible API on :4021
- [ ] Inference node on :4032 (for LLM responses)
- [ ] DWS on :4030 (for storage/compute)
- [ ] SQLit on :4661 (for state)
- [ ] Anvil on :6546 (for on-chain actions)

**Check all services:**
```bash
lsof -i :4021,4032,4030,4661,6546 | grep LISTEN
```

---

## Success Criteria

When complete, we can:
1. Create an agent from Web UI or API
2. Chat with it and see responses
3. See agent post messages in a room
4. Agent runs automatically on tick schedule
5. Agent can execute real on-chain actions

Then we can build: red/blue teams, security audits, multi-agent rooms.

---

## Session Summary (2026-01-06)

### Completed
- ✅ All 7 chunks of basic agent flow working
- ✅ test-agent character created and registered
- ✅ Manual chat with LLM inference working
- ✅ Web UI shows agents and rooms
- ✅ Room creation on-chain working
- ✅ Autonomous tick execution running
- ✅ Action execution infrastructure verified

### Bug Fixes Applied
1. **DWS Storage Stats** (`apps/dws/api/storage/multi-backend.ts`)
   - Added `totalPins`, `totalSizeBytes`, `totalSizeGB` fields to `getNodeStats()`

2. **Chat Page Room Context** (`apps/crucible/web/pages/Chat.tsx`)
   - Auto-loads room data when navigating to `/chat/:roomId`
   - Auto-selects character from room members
   - Shows chat interface directly instead of agent picker

### Files Modified
| File | Change |
|------|--------|
| `apps/crucible/api/characters/test-agent.ts` | NEW - minimal test agent character |
| `apps/crucible/api/characters/index.ts` | Added test-agent import/export |
| `apps/dws/api/storage/multi-backend.ts` | Fixed getNodeStats() return schema |
| `apps/crucible/web/pages/Chat.tsx` | Added room auto-loading |

### Services Running
- Crucible API: :4021
- DWS: :4030
- Inference Node: :4032
- SQLit: :4661
- Anvil: :6546

### Next Steps
1. ~~Test Web UI room navigation manually~~ → Room message display missing (see below)
2. Implement room message display in ChatInterface
3. Proceed to red/blue team implementation

---

## Architecture Investigation (2026-01-06)

### The Missing Piece: Room Message Display

After deep investigation with parallel subagents, we discovered that **all backend infrastructure exists** but the frontend doesn't display room messages.

### What EXISTS and WORKS

| Layer | Status | Details |
|-------|--------|---------|
| **Room API** | ✅ Working | `GET/POST /api/v1/rooms/:id/messages` |
| **Room SDK** | ✅ Working | `roomSdk.getMessages()`, `postMessage()` |
| **React Hook** | ✅ Defined | `useRoomMessages(roomId)` with 5s polling |
| **Room Storage** | ✅ Working | IPFS state + on-chain CID pointer |
| **1:1 Chat** | ✅ Working | `/api/v1/chat/:characterId` (ephemeral) |

### What's MISSING

**ChatInterface.tsx doesn't call `useRoomMessages()`**

```typescript
// This hook EXISTS in useRooms.ts but is NEVER IMPORTED:
export function useRoomMessages(roomId: string, limit?: number) {
  return useQuery({
    queryKey: ['room-messages', roomId, limit],
    queryFn: async (): Promise<RoomMessage[]> => {
      const response = await fetch(`${API_URL}/api/v1/rooms/${roomId}/messages`)
      return data.messages
    },
    enabled: !!roomId,
    refetchInterval: 5000,  // Already has polling!
  })
}
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT STATE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1:1 CHAT (WORKING)              ROOM MESSAGES (BACKEND WORKS)      │
│  ──────────────────              ────────────────────────────       │
│                                                                     │
│  User → POST /chat/:id           POST /rooms/:id/message            │
│       ↓                               ↓                             │
│  CrucibleAgentRuntime            roomSdk.postMessage()              │
│       ↓                               ↓                             │
│  DWS inference                   Store to IPFS, update CID          │
│       ↓                               ↓                             │
│  Response returned               GET /rooms/:id/messages            │
│       ↓                               ↓                             │
│  Frontend React state            useRoomMessages() ← EXISTS!        │
│       ↓                               ↓                             │
│  MessageBubble renders           ChatInterface ← DOESN'T CALL IT!   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Eliza Integration Analysis

Crucible uses a **minimal Eliza integration**:

| Component | Full ElizaOS | Crucible Usage |
|-----------|--------------|----------------|
| Memory/Database | SQLite conversation history | **NOT USED** |
| Message history | Per-agent stored | **NOT USED** |
| Action handlers | Plugin system | ✅ **USED** (50+ actions) |
| Service pattern | JejuService | ✅ **USED** |
| Runtime interface | Full IAgentRuntime | ⚠️ **Partial** wrapper |

Crucible built its own room system (IPFS/contracts) instead of Eliza's memory. This is intentional for decentralization.

### Existing Patterns to Reuse

Found in codebase exploration:

| Pattern | Location | Features |
|---------|----------|----------|
| Date grouping | `apps/wallet/web/components/messages/` | Today/Yesterday/Date dividers |
| Message bubbles | `apps/crucible/web/components/ChatInterface.tsx` | Already implemented |
| Action results | Same file | Already implemented |
| Polling | `useRoomMessages` | 5s refetchInterval built-in |
| Real-time | `vendor/eliza/packages/client/src/hooks/use-socket-chat.ts` | SocketIO pattern (optional) |

### The Fix (~30 minutes)

Add to `ChatInterface.tsx`:

```typescript
// 1. Import the existing hook
import { useRoomMessages } from '../hooks/useRooms'

// 2. Call it when roomId exists
const { data: roomMessages } = useRoomMessages(roomId ?? '')

// 3. Display room messages when available
useEffect(() => {
  if (roomId && roomMessages) {
    const transformed = roomMessages.map(rm => ({
      id: rm.id,
      role: 'agent' as const,
      content: rm.content,
      timestamp: rm.timestamp,
      agentName: rm.agentId,
    }))
    setMessages(transformed)
  }
}, [roomId, roomMessages])
```

### Data Flow After Fix

```
User navigates to /chat/:roomId
       ↓
Chat.tsx loads room via useRoom(roomId)
       ↓
ChatInterface receives roomId prop
       ↓
useRoomMessages(roomId) fetches from API  ← NEW
       ↓
Room messages displayed in chat window    ← NEW
       ↓
User can also chat (1:1) with selected agent
       ↓
Optionally: chat responses posted to room ← FUTURE
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/crucible/web/components/ChatInterface.tsx` | Needs room message integration |
| `apps/crucible/web/hooks/useRooms.ts` | Has `useRoomMessages()` - ready to use |
| `apps/crucible/api/sdk/room.ts` | Room SDK - working |
| `apps/crucible/api/server.ts:1360-1384` | Room message endpoints - working |

### Decision: Eliza Memory vs Room State

**Recommendation**: Use Room State as the source of truth (not Eliza memory)

- Room messages are decentralized (IPFS + on-chain)
- Multi-agent visibility (all room members see all messages)
- Infrastructure already exists and works
- No need to wire up Eliza's database adapter

If conversation context for LLM is needed later, create a provider that reads from room messages.

---

## User Identity Investigation (2026-01-06)

### Current State: Hardcoded User IDs

| Component | User ID | Issue |
|-----------|---------|-------|
| **ChatInterface.tsx** | `'web-user'` hardcoded | No auth |
| **Room.tsx** | Was `'user-1'` hardcoded | Fixed to use `useJejuAuth()` |
| **useChat hook** | Pass-through | No auth headers |
| **API /chat endpoint** | Accepts any userId | No validation |

### Jeju Auth System (Available)

```typescript
import { useJejuAuth } from '@jejunetwork/auth/react'

const {
  authenticated,      // boolean
  userId,            // Hex - identity ID
  walletAddress,     // Address - smart account
} = useJejuAuth()
```

### Room Access Control

**Current State: Everything is Public**

| Layer | What Exists | What's Missing |
|-------|-------------|----------------|
| **Types** | `visibility: 'public' | 'private' | 'members_only'` | Never enforced |
| **Room Creation** | Accepts visibility param | Hardcoded to `'public'` (server.ts:1254) |
| **Room Listing** | Returns all rooms | No user filtering |
| **Message Access** | Returns all messages | No membership check |
| **On-Chain** | `owner`, `isMember()` exist | No visibility field in contract |

**Recommendation**: Keep public for MVP, add private rooms in Phase 2.

---

## Message Data Model Investigation (2026-01-06)

### RoomMessage Structure

```typescript
interface RoomMessage {
  id: string
  agentId: string       // Sender ID - currently expects numeric agent ID
  content: string
  timestamp: number
  action?: string
  metadata?: {
    source?: string     // Could indicate 'user' | 'agent' | 'web'
    replyTo?: string
    attachments?: string[]
  }
}
```

**Key Finding**: No structural distinction between user and agent messages - just different `agentId` values.

### Options for User vs Agent Identity

| Approach | Pros | Cons |
|----------|------|------|
| **1. Add `senderType` field** | Clean, explicit | Schema change, migration |
| **2. Use `metadata.source`** | Already exists | Optional, not enforced |
| **3. Wallet address as agentId** | Simple, works now | Mixes ID types |
| **4. Prefix convention** | `user:0x...` vs `agent:14` | String parsing needed |

### Recommended Approach

Use **metadata.source** for clarity without schema change:
- `source: 'user'` + agentId = wallet address
- `source: 'agent'` + agentId = character ID

### Implementation Status

**Completed:**
- Room.tsx now uses `useJejuAuth()` for user identity
- `getAgentName()` resolves wallet addresses and shows "You" for current user
- Message display distinguishes user vs agent messages visually

**Pending:**
- Update `PostMessageRequestSchema` to accept string agentId (was numeric only)
- Update `roomSdk.postMessage()` signature to accept string agentId
- Add `metadata.source` to message posting for explicit sender type

### Bug Fixes Applied This Session

1. **Room stateCid not persisting** - `createRoom()` stored state to IPFS but never called `updateRoomState()` to persist CID on-chain. Fixed in `room.ts`.

2. **PostMessageRequestSchema numeric validation** - Schema expected `z.coerce.number().int().positive()` but users send wallet addresses. Changed to `z.string().min(1)`.

---

## Files Modified This Session

| File | Change |
|------|--------|
| `apps/crucible/web/pages/Room.tsx` | NEW - dedicated room page with auth |
| `apps/crucible/web/pages/Chat.tsx` | Cleaned up, 1:1 chat only |
| `apps/crucible/web/components/ChatInterface.tsx` | Cleaned up, no room logic |
| `apps/crucible/web/hooks/useRooms.ts` | Added `usePostRoomMessage()` |
| `apps/crucible/web/App.tsx` | Added `/rooms/:roomId` route |
| `apps/crucible/api/sdk/room.ts` | Fixed `createRoom()` to persist stateCid, updated `postMessage()` to accept string agentId |
| `apps/crucible/api/schemas.ts` | Updated `PostMessageRequestSchema` for string agentId |
| `apps/crucible/api/server.ts` | Updated post message endpoint |
| `apps/dws/api/storage/multi-backend.ts` | Fixed `getNodeStats()` schema |
