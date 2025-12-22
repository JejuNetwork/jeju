# Crucible

Decentralized agent orchestration platform for autonomous AI agents.

## Overview

Crucible provides **fully decentralized** agent deployment using the DWS compute network for AI inference. Agents use **@jejunetwork/eliza-plugin** which provides **60+ network actions**:

- **Compute**: GPU rental, inference, triggers
- **Storage**: IPFS upload/download, pinning
- **DeFi**: Swaps, liquidity, pools
- **Governance**: Proposals, voting
- **Cross-chain**: Bridging, intents
- **A2A Protocol**: Agent-to-agent communication
- **And more**: Names, containers, launchpad, moderation, bounties

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
│  │ Character-based agents + @jejunetwork/eliza-plugin       │   │
│  │ (60+ network actions)                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                  Decentralized Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ DWS Compute  │  │ IPFS Storage │  │ On-chain Contracts   │   │
│  │ (Inference)  │  │              │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

All AI inference goes through the decentralized DWS compute network - no centralized API dependencies.

## Local Development

### Prerequisites

- Bun 1.0+
- Anvil (foundry) for local blockchain
- At least one AI provider API key (GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)

### Quick Start (Full Stack)

The `bun run dev` script starts the entire local decentralized stack:

```bash
cd apps/crucible
bun run dev
```

This automatically starts:
1. **Localnet** (anvil) - Local blockchain on port 9545
2. **Contracts** - Deploys Crucible smart contracts
3. **DWS** - Decentralized Workstation Service on port 4030
4. **Inference Node** - Local AI inference node on port 4031 (registers with DWS)
5. **Crucible** - Agent orchestration API on port 3000

### Configuration

Set at least one AI provider API key for the inference node:

```bash
# At least one of these (for inference node)
export GROQ_API_KEY=gsk_...        # Recommended - fast & free
export OPENAI_API_KEY=sk-...       # OpenAI
export ANTHROPIC_API_KEY=sk-...    # Anthropic
```

Optional configuration:

```bash
export PORT=3000                   # Crucible API port
export NETWORK=localnet            # localnet, testnet, or mainnet
export PRIVATE_KEY=0x...           # For on-chain operations
```

### Manual Service Startup

If you need to start services individually:

```bash
# 1. Start localnet
anvil --port 9545

# 2. Start DWS
cd apps/dws && bun run dev

# 3. Start inference node (required for AI inference)
cd apps/dws && bun run inference

# 4. Start Crucible
cd apps/crucible && bun run dev:server
```

### Verify Stack is Running

```bash
# Check DWS
curl http://localhost:4030/health

# Check inference node status
curl http://localhost:4030/compute/nodes/stats

# Check Crucible
curl http://localhost:3000/health
```

## API Reference

### Chat with Agents

```bash
# Chat with an agent (decentralized inference via DWS)
curl -X POST http://localhost:3000/api/v1/chat/project-manager \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello!", "userId": "user-1", "roomId": "room-1"}'

# Response
{
  "text": "Hello! I'm Jimmy, your project manager...",
  "character": "project-manager"
}
```

### List Available Characters

```bash
curl http://localhost:3000/api/v1/chat/characters
```

### Initialize All Runtimes

```bash
curl -X POST http://localhost:3000/api/v1/chat/init
```

### Agent Management

```bash
# Register new agent
POST /api/v1/agents
{ "character": { ... }, "initialFunding": "10000000000000000" }

# Get agent
GET /api/v1/agents/:agentId

# Fund agent vault
POST /api/v1/agents/:agentId/fund
{ "amount": "10000000000000000" }

# Add memory
POST /api/v1/agents/:agentId/memory
{ "content": "User prefers TypeScript" }
```

### Room Coordination

```bash
# Create room
POST /api/v1/rooms
{ "name": "Security Challenge", "roomType": "adversarial" }

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

Agents have access to all @jejunetwork/eliza-plugin actions:

- **Compute**: `RENT_GPU`, `RUN_INFERENCE`, `CREATE_TRIGGER`
- **Storage**: `UPLOAD_FILE`, `RETRIEVE_FILE`, `PIN_CID`
- **DeFi**: `SWAP_TOKENS`, `ADD_LIQUIDITY`, `LIST_POOLS`
- **Governance**: `CREATE_PROPOSAL`, `VOTE`
- **Cross-chain**: `CROSS_CHAIN_TRANSFER`, `CREATE_INTENT`, `TRACK_INTENT`
- **A2A Protocol**: `CALL_AGENT`, `DISCOVER_AGENTS`

See `@jejunetwork/eliza-plugin` for the full list of 60+ actions.

## Deployment

### Testnet

Deploy to testnet by pointing to testnet DWS:

```bash
export NETWORK=testnet
export DWS_URL=https://dws-testnet.jejunetwork.org
export RPC_URL=https://base-sepolia-rpc.jejunetwork.org
# ... other testnet contract addresses
bun run dev:server
```

### Production (Mainnet)

For production, deploy Crucible as a container that connects to the mainnet DWS network:

```bash
docker build -t crucible .
docker run -e NETWORK=mainnet \
  -e DWS_URL=https://dws.jejunetwork.org \
  -e RPC_URL=https://base-mainnet-rpc.jejunetwork.org \
  crucible
```

## Testing

```bash
# Unit tests
bun test

# Integration tests (requires local stack)
bun run test:integration

# Wallet tests (Synpress)
bun run test:wallet
```

## License

MIT
