# Experimental Decentralized Todo App

A fully decentralized Todo application demonstrating all Jeju Network services working together.

## Features

This dApp showcases end-to-end decentralization using:

| Service | Technology | Purpose |
|---------|------------|---------|
| **Database** | CQL (CovenantSQL) | Decentralized SQL storage with BFT-Raft consensus |
| **Cache** | Compute Redis | Decentralized caching via compute network |
| **Storage** | IPFS | Frontend hosting and file attachments |
| **Secrets** | KMS (MPC) | Encrypted todos with threshold key management |
| **Triggers** | Cron | Scheduled reminders and cleanup tasks |
| **Naming** | JNS | Human-readable domain (todo.jeju) |
| **REST API** | Hono | Standard HTTP endpoints |
| **A2A** | Agent-to-Agent | AI agent integration |
| **MCP** | Model Context Protocol | Tool integration for AI |
| **Auth** | Wallet Signatures | Web3 authentication |

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# In another terminal, start frontend
bun run dev:frontend
```

## Development

### Backend Server (Port 4500)

```bash
bun run dev
```

Endpoints:
- REST API: `http://localhost:4500/api/v1`
- A2A: `http://localhost:4500/a2a`
- MCP: `http://localhost:4500/mcp`
- Health: `http://localhost:4500/health`
- Agent Card: `http://localhost:4500/a2a/.well-known/agent-card.json`

### Frontend (Port 4501)

```bash
bun run dev:frontend
```

Access at `http://localhost:4501`

### Database Migration

```bash
bun run migrate
```

## Testing

```bash
# Run all tests
bun test

# Run E2E tests (requires running server)
bun run test:e2e
```

## Deployment

### Local Deployment

```bash
# Build the app
bun run build

# Deploy to local network
bun run deploy
```

### Testnet Deployment

```bash
NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... bun run deploy
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (IPFS)                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  React App → Wallet Auth → REST/A2A/MCP Clients         │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Compute Network)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ REST API │  │   A2A    │  │   MCP    │  │ Webhooks │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │          │
│       └─────────────┴──────┬──────┴─────────────┘          │
│                            │                               │
│                    ┌───────▼───────┐                       │
│                    │  Todo Service │                       │
│                    └───────┬───────┘                       │
│       ┌────────────────────┼────────────────────┐          │
│       ▼                    ▼                    ▼          │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐       │
│  │  Cache  │         │   DB    │         │ Storage │       │
│  │ (Redis) │         │  (CQL)  │         │ (IPFS)  │       │
│  └─────────┘         └─────────┘         └─────────┘       │
│       │                    │                    │          │
│       ▼                    ▼                    ▼          │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐       │
│  │   KMS   │         │  Cron   │         │   JNS   │       │
│  │  (MPC)  │         │Triggers │         │ (Names) │       │
│  └─────────┘         └─────────┘         └─────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/todos` | List todos |
| POST | `/api/v1/todos` | Create todo |
| GET | `/api/v1/todos/:id` | Get todo |
| PATCH | `/api/v1/todos/:id` | Update todo |
| DELETE | `/api/v1/todos/:id` | Delete todo |
| POST | `/api/v1/todos/:id/encrypt` | Encrypt todo |
| POST | `/api/v1/todos/:id/decrypt` | Decrypt todo |
| POST | `/api/v1/todos/:id/attach` | Upload attachment |
| GET | `/api/v1/stats` | Get statistics |
| POST | `/api/v1/todos/bulk/complete` | Bulk complete |
| POST | `/api/v1/todos/bulk/delete` | Bulk delete |

### A2A Skills

| Skill ID | Description |
|----------|-------------|
| `list-todos` | List all todos |
| `create-todo` | Create a new todo |
| `complete-todo` | Mark todo complete |
| `delete-todo` | Delete a todo |
| `get-summary` | Get statistics |
| `set-reminder` | Schedule reminder |
| `prioritize` | AI prioritization |

### MCP Tools

| Tool | Description |
|------|-------------|
| `list_todos` | List with filters |
| `create_todo` | Create todo |
| `update_todo` | Update todo |
| `delete_todo` | Delete todo |
| `get_stats` | Get statistics |
| `schedule_reminder` | Set reminder |
| `bulk_complete` | Complete multiple |

### Authentication

All authenticated requests require these headers:

```
x-jeju-address: <wallet address>
x-jeju-timestamp: <unix timestamp ms>
x-jeju-signature: <signature of "jeju-todo:{timestamp}">
```

## Environment Variables

```bash
# Server
PORT=4500
FRONTEND_PORT=4501

# Services
CQL_BLOCK_PRODUCER_ENDPOINT=http://localhost:4300
CQL_DATABASE_ID=todo-experimental
COMPUTE_CACHE_ENDPOINT=http://localhost:4200/cache
KMS_ENDPOINT=http://localhost:4400
STORAGE_API_ENDPOINT=http://localhost:4010
IPFS_GATEWAY=http://localhost:4180
GATEWAY_API=http://localhost:4020
CRON_ENDPOINT=http://localhost:4200/cron

# Deployment
NETWORK=localnet
DEPLOYER_PRIVATE_KEY=0x...
JNS_NAME=todo.jeju
```

## License

MIT
