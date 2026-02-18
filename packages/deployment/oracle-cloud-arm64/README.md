# Jeju Oracle Cloud ARM64 Deployment

Deploy the complete Jeju stack on Oracle Cloud ARM64 (Ampere) instances.

## Overview

This deployment is designed for Oracle Cloud's Always Free tier using ARM64 processors.

## Services

### L2 Blockchain Stack

| Service | Port | Description |
|---------|------|-------------|
| L1 Geth | 8545 | Ethereum L1 (--dev mode) |
| op-geth | 9545 | L2 Execution Layer |
| op-node | 7545 | L2 Consensus Layer |
| op-batcher | 6545 | Batch Submitter |

### Infrastructure

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Database for Indexer/Crucible |
| SQLit | 4661 | Distributed state layer for DWS |

### Jeju Applications

| Service | Port | Description |
|---------|------|-------------|
| DWS | 4030 | Decentralized Web Services coordinator |
| Indexer | 4350-4352 | Blockchain indexer (GraphQL, REST, A2A) |
| Crucible | 4020-4022 | Agent orchestration platform |
| Factory | 4008 | Developer coordination hub |
| Gateway | 4001 | Bridge, staking, token registry |
| Wallet | 4015 | Crypto wallet |
| Node | 4070 | Infrastructure provider |

## Quick Start

```bash
# SSH into Oracle instance
ssh ubuntu@<your-ip>

# Clone repo
git clone https://github.com/elizaos/jeju.git
cd jeju/packages/deployment/oracle-cloud-arm64

# Start L2 blockchain
cd docker
docker compose up -d l1-geth
sleep 10
../scripts/init-genesis.sh phase1
docker compose up -d op-geth
sleep 15
../scripts/init-genesis.sh phase2
docker compose up -d op-node op-batcher

# Start infrastructure
docker compose up -d postgres sqlit

# Start apps
docker compose up -d dws indexer
docker compose up -d crucible factory gateway wallet node
```

## ARM64 Compatibility

All Dockerfiles in this deployment are ARM64-native:
- Use `oven/bun:1.3` (multi-arch)
- Use `postgres:15` (multi-arch)
- Use `nginx:alpine` (multi-arch)
- Replaced x86_64 binaries with ARM64 equivalents (e.g., workerd)

## Building Images

Images are built on-demand the first time you run `docker compose up`:

```bash
# Build all app images
docker compose build

# Build specific service
docker compose build dws

# Rebuild with no cache
docker compose build --no-cache indexer
```

## Directory Structure

```
oracle-cloud-arm64/
├── docker/
│   ├── docker-compose.yaml    # All services
│   ├── config/                # L2 config files
│   │   ├── genesis.json
│   │   └── rollup.json
│   ├── jwt/
│   │   └── jwt.hex            # JWT secret
│   └── Dockerfiles/           # ARM64-specific Dockerfiles
│       ├── Dockerfile.dws
│       ├── Dockerfile.indexer
│       ├── Dockerfile.crucible
│       ├── Dockerfile.factory
│       ├── Dockerfile.gateway
│       ├── Dockerfile.wallet
│       ├── Dockerfile.node
│       └── Dockerfile.sqlit
├── scripts/
│   └── init-genesis.sh        # Genesis initialization
└── README.md
```

## Environment Variables

### DWS
```bash
NETWORK=localnet
RPC_URL=http://op-geth:9545
SQLIT_URL=http://sqlit:4661
```

### Indexer
```bash
DB_HOST=postgres
DB_PORT=5432
DB_NAME=indexer
DB_USER=postgres
DB_PASS=postgres
RPC_ENDPOINT=http://op-geth:9545
MODE=processor  # processor, api, graphql, or full
```

### Crucible
```bash
DWS_URL=http://dws:4030
DATABASE_URL=postgres://postgres:postgres@postgres:5432/crucible
RPC_URL=http://op-geth:9545
```

### Factory
```bash
PORT=4008
RPC_URL=http://op-geth:9545
DWS_URL=http://dws:4030
```

### Gateway
```bash
VITE_RPC_URL=http://localhost:9545
VITE_NETWORK=localnet
```

### Wallet
```bash
PORT=4015
VITE_RPC_URL=http://localhost:9545
VITE_NETWORK=localnet
```

### Node
```bash
JEJU_NETWORK=localnet
PORT=4070
RPC_URL=http://op-geth:9545
DWS_URL=http://dws:4030
```

## Service Dependencies

```
l1-geth
    └── op-geth
        └── op-node
            └── op-batcher
        └── dws (requires sqlit)
            └── crucible
            └── node
        └── indexer (requires postgres)
        └── factory
        └── gateway
        └── wallet
```

## Troubleshooting

### Service won't start

Check logs:
```bash
docker compose logs <service-name>
docker compose logs -f <service-name>  # Follow logs
```

### Build fails

ARM64 builds may fail if Dockerfiles reference x86_64-only packages.
Check for platform-specific binaries and replace with ARM64 equivalents.

### SQLit connection errors

DWS requires SQLit. Ensure SQLit is running:
```bash
docker compose up -d sqlit
docker compose logs sqlit
```

### Workspace module resolution errors

If you see "Cannot find module @jejunetwork/..." errors, the workspace symlinks
may be incorrect. Rebuild the image with `--no-cache`:
```bash
docker compose build --no-cache <service>
```

### L1 genesis block hash mismatch

Re-run `init-genesis.sh phase1` after L1 restarts:
```bash
../scripts/init-genesis.sh phase1
```

### L2 not producing blocks

Check op-node health and logs:
```bash
docker compose logs op-node
curl localhost:7545/healthz
```

### Clean restart

If persistent issues occur, do a clean restart:
```bash
docker compose down
docker volume rm docker_l1-data docker_l2-data
docker compose up -d l1-geth
sleep 10
../scripts/init-genesis.sh phase1
docker compose up -d op-geth
sleep 15
../scripts/init-genesis.sh phase2
docker compose up -d op-node op-batcher
```

## Known Issues and Workarounds

### Indexer TypeORM Decorator Metadata

The indexer uses Subsquid with TypeORM which requires decorator metadata for entity
definitions. This requires special handling:

1. **Bun Runtime Issue**: Bun doesn't handle circular dependencies in TypeORM
   decorators correctly, causing `ReferenceError: Cannot access 'X' before initialization`

2. **tsx Runtime Issue**: Using tsx (TypeScript execution for Node.js) doesn't emit
   decorator metadata, causing `ColumnTypeUndefinedError: Column type for X#id is not
   defined and cannot be guessed`

**Solution**: The indexer Dockerfile compiles TypeScript to JavaScript in the builder
stage using `tsc` (which emits decorator metadata with `emitDecoratorMetadata: true`),
then runs the compiled JavaScript in the production stage:

```dockerfile
# In builder stage - compile TypeScript
RUN bun x tsc --outDir lib --declaration false --sourceMap false

# In production stage - run compiled JavaScript
CMD ["node", "lib/api/main.js"]
```

### App Entry Points

Different apps have different entry points. Check the app's `package.json` or
`scripts/` directory for the correct entry point:

| App | Entry Point | Notes |
|-----|-------------|-------|
| DWS | `scripts/serve.ts` | Bun runtime |
| Indexer | `lib/api/main.js` | Compiled JS, Node.js runtime |
| Crucible | `scripts/start.ts` | Bun runtime |
| Factory | `scripts/serve.ts` | Bun runtime |
| Node | `scripts/serve.ts` | Bun runtime |
| Gateway | nginx static | Vite SPA |
| Wallet | nginx static | Vite SPA |

### Health Check Status "unhealthy"

Some services may show "unhealthy" in `docker compose ps` even when they're working.
This is because the healthcheck uses `curl` or `wget` which aren't available in
slim images. The services still work correctly - verify with:

```bash
curl http://localhost:4030/health  # DWS
curl http://localhost:4661/health  # SQLit
curl http://localhost:4008/health  # Factory
```

### Workspace Symlinks

The workspace packages (@jejunetwork/*) are linked via symlinks in node_modules.
The symlink paths differ between:
- Builder stage: `../../packages/X` (from /app)
- Runtime stage: `../../../../packages/X` (from /app/apps/indexer/node_modules/@jejunetwork/X)

Special package name mappings:
- `packages/bridge` → `@jejunetwork/zksolbridge`
- `apps/dws` → `@jejunetwork/dws`

### Frontend Apps (Gateway, Wallet)

Gateway and Wallet are Vite-built SPAs. They require:
1. Vite build to create static assets
2. nginx to serve the built files
3. Environment variables at build time (not runtime)

To update environment variables, rebuild the images.

### Factory SQLit Configuration

Factory requires SQLit for distributed state. Ensure these environment variables
are set in docker-compose.yaml:

```yaml
factory:
  environment:
    - SQLIT_ENDPOINT=http://sqlit:4661
    - SQLIT_DATABASE_ID=factory
  depends_on:
    sqlit:
      condition: service_started
```

### L2 rollup.json Configuration

The `rollup.json` file must not contain `_comment` fields (op-node can't parse them).
It also requires actual genesis hashes from the running L1/L2 chains:

```json
{
  "genesis": {
    "l1": {
      "hash": "<actual-l1-genesis-hash>",
      "number": 0
    },
    "l2": {
      "hash": "<actual-l2-genesis-hash>",
      "number": 0
    },
    "l2_time": <actual-l2-genesis-timestamp>
  }
}
```

Get these values after starting L1 and L2:
```bash
# L1 genesis hash
curl -s -X POST http://localhost:8545 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x0",false],"id":1}' \
  | jq -r '.result.hash'

# L2 genesis hash and timestamp
curl -s -X POST http://localhost:9545 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x0",false],"id":1}' \
  | jq -r '.result.hash, .result.timestamp'
```

## Accessing Services

After deployment, services are accessible at:

| Service | URL |
|---------|-----|
| L2 RPC | http://<ip>:9545 |
| DWS | http://<ip>:4030 |
| Indexer GraphQL | http://<ip>:4350/graphql |
| Indexer REST | http://<ip>:4352 |
| Crucible | http://<ip>:4020 |
| Factory | http://<ip>:4008 |
| Gateway | http://<ip>:4001 |
| Wallet | http://<ip>:4015 |
| Node | http://<ip>:4070 |

## Pre-built Image

A working Jeju L2 image is available for quick deployment:

**Public Download (QCOW2):**
```
https://objectstorage.us-sanjose-1.oraclecloud.com/n/axhupkjmbqfj/b/jeju-images/o/jeju-l2-arm64.qcow2
```

**Oracle Cloud Image OCID** (us-sanjose-1 region):
```
ocid1.image.oc1.us-sanjose-1.aaaaaaaa4mp76zw6gouybvxuqkuimznt4jfnylwn3xdaihshjflj5wcbilha
```

| Property | Value |
|----------|-------|
| Name | jeju-l2-working-20260126 |
| Format | QCOW2 (ARM64) |
| Size | 1.83 GB |
| Shape | VM.Standard.A1.Flex |
| OS | Ubuntu 24.04 |
