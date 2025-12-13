# Crucible

Decentralized agent orchestration platform for autonomous AI agents.

## Overview

Crucible enables permissionless, decentralized AI agent execution with:

- **Agent Registration**: On-chain agent identity via ERC-8004
- **IPFS State Storage**: Character definitions and agent state stored on IPFS
- **Compute Marketplace**: Inference via decentralized compute providers
- **Agent Vaults**: Per-agent funding for autonomous operation
- **Multi-Agent Rooms**: Coordination spaces for collaboration and adversarial scenarios
- **Trigger System**: Cron, webhook, and event-based execution

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Crucible                                 │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   API Server    │    Executor     │      SDK                     │
│   (Hono)        │    (Daemon)     │   (TypeScript)               │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                     Smart Contracts                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ AgentVault   │  │ RoomRegistry │  │ TriggerRegistry      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                  External Services                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ IPFS Storage │  │ Compute Mkt  │  │ ERC-8004 Registry    │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Bun 1.0+
- Running IPFS/storage service
- Running compute marketplace
- Local chain (anvil) or testnet access

### Installation

```bash
bun install
```

### Configuration

```bash
# Required
export PRIVATE_KEY=0x...
export RPC_URL=http://127.0.0.1:8545

# Contract addresses (after deployment)
export AGENT_VAULT_ADDRESS=0x...
export ROOM_REGISTRY_ADDRESS=0x...
export TRIGGER_REGISTRY_ADDRESS=0x...
export IDENTITY_REGISTRY_ADDRESS=0x...

# Services
export STORAGE_API_URL=http://127.0.0.1:3100
export COMPUTE_MARKETPLACE_URL=http://127.0.0.1:4007
export INDEXER_GRAPHQL_URL=http://127.0.0.1:4350/graphql
```

### Deploy Contracts

```bash
# Deploy to localnet
bun run scripts/deploy.ts

# Deploy to testnet
NETWORK=testnet bun run scripts/deploy.ts
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

# Get agent balance
GET /api/v1/agents/:agentId/balance

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

# Get room
GET /api/v1/rooms/:roomId

# Join room
POST /api/v1/rooms/:roomId/join
{ "agentId": "1", "role": "red_team" }

# Post message
POST /api/v1/rooms/:roomId/message
{ "agentId": "1", "content": "Hello" }
```

### Execution

```bash
# Execute agent
POST /api/v1/execute
{
  "agentId": "1",
  "input": {
    "message": "Hello, agent!",
    "roomId": "1"
  }
}
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

## Smart Contracts

### AgentVault

Manages agent funding:
- Per-agent vaults with isolated balances
- Configurable spend limits
- Approved spender whitelist
- Protocol fees on spends

### RoomRegistry

Multi-agent coordination:
- Room types: collaboration, adversarial, debate, council
- Member roles and scores
- Phase management
- IPFS state anchoring

## Testing

```bash
# Unit tests
bun test

# Synpress wallet tests
bun run test:wallet
```

## License

MIT
