# Experimental Todo App

A Todo application demonstrating all Jeju Network services working together.

## Features

This dApp showcases end-to-end decentralization using:

| Service | Technology | Purpose |
|---------|------------|---------|
| **Database** | EQLite (EQLite) | Decentralized SQL storage with BFT-Raft consensus |
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

# Start both frontend and backend (with HMR)
bun run dev
```

This starts:
- **Frontend**: http://localhost:4501 (with API proxy)
- **Backend API**: http://localhost:4500

## Development

### Full Stack (Recommended)

```bash
bun run dev
```

This runs both servers concurrently with hot module reloading:
- API server with `bun --watch` for automatic restarts
- Frontend server with TypeScript transpilation and API proxy

### Individual Servers

```bash
# Backend only (port 4500)
bun run dev:api

# Frontend only (port 4501)
bun run dev:web
```

### API Endpoints

- REST API: `http://localhost:4500/api/v1`
- A2A: `http://localhost:4500/a2a`
- MCP: `http://localhost:4500/mcp`
- x402: `http://localhost:4500/x402`
- Auth: `http://localhost:4500/auth`
- Health: `http://localhost:4500/health`
- Agent Card: `http://localhost:4500/a2a/.well-known/agent-card.json`

### Frontend Proxy

The frontend dev server proxies all API requests to the backend:
- `/api/*` → `http://localhost:4500/api/*`
- `/a2a/*` → `http://localhost:4500/a2a/*`
- `/mcp/*` → `http://localhost:4500/mcp/*`
- etc.

## Testing

```bash
# Run unit tests
bun run test

# Run API integration tests (requires running server)
bun run test:integration

# Run Playwright e2e tests (requires running server)
bun run test:e2e

# Run Synpress wallet tests (requires running server + MetaMask)
bun run test:wallet

# Run all tests
bun run test:all
```

### Test Structure

```
tests/
├── unit/           # Pure unit tests (no server needed)
├── integration/    # API integration tests (needs server)
├── e2e/            # Playwright browser tests
└── wallet/         # Synpress MetaMask wallet tests
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
│  │ (Redis) │         │  (EQLite)  │         │ (IPFS)  │       │
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
EQLITE_BLOCK_PRODUCER_ENDPOINT=http://localhost:4661
EQLITE_DATABASE_ID=todo-experimental
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
