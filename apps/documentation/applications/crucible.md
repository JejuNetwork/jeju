# Crucible

Agent orchestration platform.

## What It Does

Crucible deploys and manages AI agents with ElizaOS + @jejunetwork/eliza-plugin.

Agents have access to 60+ network actions:
- Compute: GPU rental, inference, triggers
- Storage: IPFS upload/download
- DeFi: Swaps, liquidity
- Governance: Proposals, voting
- Cross-chain: Bridging, intents
- A2A: Agent-to-agent communication

## Quick Start

```bash
cd apps/crucible
bun install

# Set environment
export PRIVATE_KEY=0x...
export RPC_URL=http://127.0.0.1:9545
export NETWORK=localnet

bun run dev
```

Runs on http://localhost:4020

## Chat with Agents

```bash
POST /api/v1/chat/:characterId
{
  "text": "Hello",
  "userId": "user-123",
  "roomId": "room-456"
}
```

## Pre-built Characters

| ID | Name | Role |
|----|------|------|
| `project-manager` | Jimmy | Coordination, todos |
| `community-manager` | Eli5 | Support, moderation |
| `devrel` | Eddy | Technical support |
| `red-team` | Phoenix | Security testing |
| `blue-team` | Shield | Defense |

## Agent Actions

Agents can:

| Category | Actions |
|----------|---------|
| Compute | `RENT_GPU`, `RUN_INFERENCE`, `CREATE_TRIGGER` |
| Storage | `UPLOAD_FILE`, `RETRIEVE_FILE`, `PIN_CID` |
| DeFi | `SWAP_TOKENS`, `ADD_LIQUIDITY` |
| Governance | `CREATE_PROPOSAL`, `VOTE` |
| Cross-chain | `CROSS_CHAIN_TRANSFER`, `CREATE_INTENT` |
| A2A | `CALL_AGENT`, `DISCOVER_AGENTS` |

## API

```bash
# Initialize runtimes
POST /api/v1/chat/init

# List characters
GET /api/v1/characters

# Register agent
POST /api/v1/agents
{ "character": {...}, "initialFunding": "10000000000000000" }

# Create room
POST /api/v1/rooms
{ "name": "...", "roomType": "collaboration" }

# Join room
POST /api/v1/rooms/:roomId/join
{ "agentId": "1", "role": "analyst" }
```

## Custom Plugins

```typescript
import { runtimeManager } from '@jejunetwork/crucible';

const myPlugin = {
  name: 'my-plugin',
  actions: [myAction1, myAction2],
};

const runtime = await runtimeManager.createRuntime({
  agentId: 'my-agent',
  character: myCharacter,
  plugins: [myPlugin],
});
```

## Environment

```bash
PRIVATE_KEY=0x...
RPC_URL=http://127.0.0.1:9545
NETWORK=localnet
STORAGE_API_URL=http://127.0.0.1:3100
COMPUTE_MARKETPLACE_URL=http://127.0.0.1:4007
INDEXER_GRAPHQL_URL=http://127.0.0.1:4350/graphql
PORT=4020
```

---

<details>
<summary>📋 Copy as Context</summary>

```
Crucible - Agent Orchestration

Features: ElizaOS + 60+ network actions

Characters: project-manager, community-manager, devrel, red-team, blue-team

Actions: RENT_GPU, RUN_INFERENCE, UPLOAD_FILE, SWAP_TOKENS, CREATE_PROPOSAL, CROSS_CHAIN_TRANSFER, CALL_AGENT

API:
POST /api/v1/chat/:characterId - Chat
POST /api/v1/chat/init - Initialize
POST /api/v1/agents - Register agent
POST /api/v1/rooms - Create room

Local: cd apps/crucible && bun run dev
Port: 4020
```

</details>
