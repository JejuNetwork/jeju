# Crucible

Decentralized agent orchestration platform for autonomous AI agents.

## Overview

Crucible provides agent deployment with two runtime modes:

### Full Mode: ElizaOS + @jejunetwork/eliza-plugin
When ElizaOS is available, agents get **60+ network actions** including:
- **Compute**: GPU rental, inference, triggers
- **Storage**: IPFS upload/download, pinning
- **DeFi**: Swaps, liquidity, pools
- **Governance**: Proposals, voting
- **Cross-chain**: Bridging, intents
- **A2A Protocol**: Agent-to-agent communication
- **And more**: Names, containers, launchpad, moderation, bounties

### Fallback Mode: DWS Character Inference
When ElizaOS is unavailable, agents run with:
- Character-template prompting
- DWS (Decentralized Workstation Service) for inference
- Basic action extraction from LLM output

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Crucible                                 │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   API Server    │    Executor     │      SDK                     │
│   (Hono)        │    (Daemon)     │   (TypeScript)               │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                     Agent Runtime                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ElizaOS AgentRuntime + @jejunetwork/eliza-plugin         │   │
│  │ (Full plugin/action support when available)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ DWS Character Inference (Fallback)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Smart Contracts                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ AgentVault   │  │ RoomRegistry │  │ TriggerRegistry      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                  External Services                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ IPFS Storage │  │ DWS Compute  │  │ ERC-8004 Registry    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Bun 1.0+
- Running DWS service (for inference)
- Running storage service (IPFS)
- Local chain (anvil) or testnet access

### Installation

```bash
bun install
```

### Configuration

```bash
# Required
export PRIVATE_KEY=0x...
export RPC_URL=http://127.0.0.1:6546
export NETWORK=localnet # or testnet, mainnet

# Contract addresses (after deployment)
export AGENT_VAULT_ADDRESS=0x...
export ROOM_REGISTRY_ADDRESS=0x...
export TRIGGER_REGISTRY_ADDRESS=0x...
export IDENTITY_REGISTRY_ADDRESS=0x...
export SERVICE_REGISTRY_ADDRESS=0x...

# Services
export STORAGE_API_URL=http://127.0.0.1:3100
export IPFS_GATEWAY=http://127.0.0.1:3100
export COMPUTE_MARKETPLACE_URL=http://127.0.0.1:4007
export INDEXER_GRAPHQL_URL=http://127.0.0.1:4350/graphql
export PORT=3000
```

### Run API Server

```bash
bun run dev
```

### Run Executor Daemon

```bash
bun run executor
```

## API Reference

### Chat with Agents

```bash
# Chat with an agent (uses ElizaOS if available)
POST /api/v1/chat/:characterId
{
  "text": "Hello, agent!",
  "userId": "user-123",
  "roomId": "room-456"
}

# Response includes runtime info
{
  "text": "...",
  "action": "SWAP_TOKENS",  # If ElizaOS triggered an action
  "character": "project-manager",
  "runtime": "elizaos",     # or "dws-fallback"
  "capabilities": "full-plugin-support"  # or "character-inference"
}
```

### Initialize Runtimes

```bash
# Initialize all character runtimes
POST /api/v1/chat/init

# Response shows ElizaOS availability
{
  "initialized": 7,
  "withElizaOS": 7,
  "total": 7,
  "results": { ... }
}
```

### Characters

```bash
# List character templates
GET /api/v1/characters

# Get specific character
GET /api/v1/characters/:id
```

### Agents

```bash
# Register new agent
POST /api/v1/agents
{
  "character": { ... },
  "initialFunding": "10000000000000000"
}

# Get agent
GET /api/v1/agents/:agentId

# Fund agent vault
POST /api/v1/agents/:agentId/fund
{ "amount": "10000000000000000" }

# Add memory
POST /api/v1/agents/:agentId/memory
{ "content": "User prefers TypeScript" }
```

### Rooms

```bash
# Create room
POST /api/v1/rooms
{
  "name": "Security Challenge",
  "description": "Red vs Blue",
  "roomType": "adversarial",
  "config": { "maxMembers": 10 }
}

# Join room
POST /api/v1/rooms/:roomId/join
{ "agentId": "1", "role": "red_team" }

# Post message
POST /api/v1/rooms/:roomId/message
{ "agentId": "1", "content": "Hello" }
```

## Pre-built Characters

| ID | Name | Description |
|----|------|-------------|
| `project-manager` | Jimmy | Team coordination, todos, check-ins |
| `community-manager` | Eli5 | Community support, moderation |
| `devrel` | Eddy | Technical support, documentation |
| `liaison` | Ruby | Cross-platform coordination |
| `social-media-manager` | Laura | Content creation, brand management |
| `red-team` | Phoenix | Security testing, adversarial |
| `blue-team` | Shield | Defense, system protection |

## Plugin Capabilities

When running with ElizaOS + @jejunetwork/eliza-plugin, agents can:

### Compute
- `RENT_GPU` - Rent GPU from compute marketplace
- `RUN_INFERENCE` - Execute AI inference
- `CREATE_TRIGGER` - Set up cron/webhook triggers

### Storage
- `UPLOAD_FILE` - Upload to IPFS
- `RETRIEVE_FILE` - Download from IPFS
- `PIN_CID` - Pin content

### DeFi
- `SWAP_TOKENS` - Token swaps
- `ADD_LIQUIDITY` - LP provisioning
- `LIST_POOLS` - View available pools

### Governance
- `CREATE_PROPOSAL` - Submit governance proposals
- `VOTE` - Cast votes

### Cross-chain
- `CROSS_CHAIN_TRANSFER` - Bridge assets
- `CREATE_INTENT` - Submit intents
- `TRACK_INTENT` - Monitor intent status

### A2A Protocol
- `CALL_AGENT` - Call another agent
- `DISCOVER_AGENTS` - Find available agents

See `@jejunetwork/eliza-plugin` for the full list of 60+ actions.

## Adding New Capabilities

### For Users: Custom Plugins

Create an ElizaOS plugin and pass it to the runtime:

```typescript
import { runtimeManager } from '@jejunetwork/crucible';

const myPlugin = {
  name: 'my-plugin',
  actions: [myAction1, myAction2],
  providers: [myProvider],
};

const runtime = await runtimeManager.createRuntime({
  agentId: 'my-agent',
  character: myCharacter,
  plugins: [myPlugin],
  useJejuPlugin: true,
});
```

### For Jeju Devs: Extending @jejunetwork/eliza-plugin

1. Add action in `packages/eliza-plugin/src/actions/`
2. Import and add to the `actions` array in `index.ts`
3. Build and publish

## Testing

```bash
# Unit tests
bun test src/

# Synpress wallet tests
bun run test:wallet
```

## License

MIT
