# Port Allocations

All port assignments for Jeju services.

## Core Apps (4000-4399)

Gateway UI runs on port 4001 (`GATEWAY_PORT`). Gateway Node API runs on port 4002. Gateway A2A runs on port 4003. Documentation runs on port 4004 (`DOCUMENTATION_PORT`). Predimarket runs on port 4005. Bazaar runs on port 4006 (`BAZAAR_PORT`). Compute Marketplace runs on port 4007 (`COMPUTE_PORT`). Compute Node API runs on port 4008. Compute Gateway runs on port 4009. Storage API runs on port 4010 (`STORAGE_PORT`). Gateway WebSocket runs on port 4012. Crucible API runs on port 4020. Crucible Executor runs on port 4021. Autocrat runs on port 4050.

## Indexer (4350-4399)

Indexer GraphQL runs on port 4350 (`INDEXER_GRAPHQL_PORT`).

## Storage (3100, 4100)

Storage API runs on port 3100 (`IPFS_PORT`). IPFS Node runs on port 4100. IPFS Swarm runs on port 4101. IPFS Gateway runs on port 4180.

## Payments (3400)

x402 Facilitator runs on port 3402 (`FACILITATOR_PORT`).

## Vendor Apps (5000-5999)

Launchpad Frontend runs on port 5003. Launchpad Backend runs on port 5004. OTC Desk runs on port 5005. Cloud runs on port 5006. Leaderboard runs on port 5012. Hyperscape Client runs on port 5013. Hyperscape Server runs on port 5014.

## Infrastructure (8000-9999)

L1 RPC (Geth) runs on port 8545 (`L1_RPC_PORT`). Prometheus runs on port 9090. Monitoring A2A runs on port 9091. L2 RPC (op-reth) runs on port 9545 (`L2_RPC_PORT`). L2 WebSocket runs on port 9546 (`L2_WS_PORT`). Kurtosis UI runs on port 9711.

## Database

Indexer PostgreSQL runs on port 23798 (`INDEXER_DB_PORT`).

## Overriding Ports

Set via environment variable:

```bash
GATEWAY_PORT=5001 bun run dev
```

Or in `.env.local`:

```bash
GATEWAY_PORT=5001
BAZAAR_PORT=5006
```

Or in code:

```typescript
import { CORE_PORTS } from '@jejunetwork/config/ports';
const gatewayPort = CORE_PORTS.GATEWAY.get();
```

## Port Management

Check all port allocations with `bun run ports`. Check a specific port with `lsof -i :9545`. Kill a process on a port with `kill -9 $(lsof -t -i :9545)`.

## Port Conflicts

If you see "port already in use", find what's using the port with `lsof -i :4001`, kill Jeju processes with `bun run cleanup`, or kill a specific process with `kill -9 <PID>`.

## Production Ports

In production, services run behind load balancers. Gateway, Bazaar, RPC, and GraphQL all run on internal ports but are exposed externally on port 443 (HTTPS).
