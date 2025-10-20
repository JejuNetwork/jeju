# Crucible Integration with Jeju Monorepo

## Manifest Configuration

Crucible is registered in the Jeju monorepo via `jeju-manifest.json`:

```json
{
  "name": "crucible",
  "type": "app",
  "autoStart": false,
  "optional": true,
  "enabled": true
}
```

### Why autoStart: false?

Crucible is **optional** because it:
- Requires external AI API keys (OpenAI/Anthropic)
- Runs resource-intensive multi-agent simulations
- Is primarily for security testing, not core functionality
- Can run in Docker containers or locally

### How to Enable Auto-Start

Edit `apps/crucible/jeju-manifest.json`:
```json
{
  "autoStart": true
}
```

Then Crucible will start automatically when running `bun run dev` from repo root.

## Manual Start Options

### From Repo Root

```bash
# Start all apps (including Crucible if autoStart: true)
bun run dev

# Start only Crucible
cd apps/crucible && bun run dev
```

### From Crucible Directory

```bash
cd apps/crucible

# Local development
bun run dev

# Docker container
docker-compose -f docker/docker-compose.yml up -d

# Podman container
podman-compose -f docker/docker-compose.yml up -d
```

## Dependencies

Crucible requires:

1. **Jeju Localnet** - Must be running first
   - Provides RPC at `http://127.0.0.1:9545`
   - Contracts must be deployed
   - Test wallets must be funded

2. **AI API Key** - Either:
   - `OPENAI_API_KEY=sk-...` in `.env`
   - `ANTHROPIC_API_KEY=sk-ant-...` in `.env`

3. **Contract Addresses** - Loaded from:
   - `contracts/deployments/localnet-addresses.json`
   - Or configured manually in `.env`

## Integration Points

### Contracts

Crucible integrates with:
- **ERC-8004 IdentityRegistry**: Agent registration
- **ReputationRegistry**: Reputation tracking
- **RegistryGovernance**: Proposals and appeals
- **UnifiedReportingSystem**: Reports and bans
- **BanManager**: Network/app bans
- **LabelManager**: HACKER/SCAMMER labels
- **Predimarket**: Futarchy voting
- **PaymasterFactory**: Gas abstraction
- **LiquidityPaymaster**: Token gas payment

### Services

Crucible provides:
- **API Server**: `http://localhost:7777`
- **Dashboard**: `http://localhost:7777/dashboard`
- **A2A Endpoint**: `http://localhost:7777/api/a2a`
- **Metrics API**: `http://localhost:7777/api/crucible/metrics`

## Startup Sequence

When `bun run dev` is executed from repo root:

1. **Preflight checks** run
2. **Localnet starts** (anvil + contracts)
3. **Core apps start** (gateway, indexer, etc.)
4. **Optional apps** check `autoStart`:
   - If `true`: Start automatically
   - If `false`: Skip (user must start manually)

For Crucible with `autoStart: false`:
```bash
# Localnet is already running from step 2
cd apps/crucible

# Quick setup
bun run deploy  # One-time setup

# Add API key
echo "OPENAI_API_KEY=sk-..." >> .env

# Start Crucible
bun run dev
```

## Environment Isolation

Crucible runs in isolation:
- Separate database (`crucible.db` or PostgreSQL)
- Separate agent wallets (10 funded accounts)
- Separate evidence storage (`./data/evidence/`)
- Separate logs (`./logs/`)

Does not interfere with other apps.

## Testing Integration

### From Repo Root

```bash
# Run all tests (includes Crucible if manifests/tests are configured)
bun run test
```

### From Crucible

```bash
cd apps/crucible

# Run Crucible tests only
bun run test

# Run specific test suites
bun test tests/unit/
bun test tests/integration/
bun test tests/scenarios/
```

## Docker Integration

Crucible can run in Docker while localnet runs on host:

```yaml
# docker-compose.yml includes:
extra_hosts:
  - "host.docker.internal:host-gateway"

environment:
  JEJU_L2_RPC: http://host.docker.internal:9545
```

This allows containerized agents to access host localnet.

### RPC Health Check

Docker Compose includes an init container that verifies localnet connectivity before starting Crucible:

```yaml
rpc-check:
  image: curlimages/curl:latest
  command: # Polls RPC for 60s, fails if not accessible
```

## Monitoring Integration

### Health Endpoint

```bash
curl http://localhost:7777/api/health
```

Can be integrated into repo-wide health monitoring.

### Metrics Integration

```bash
# Crucible-specific metrics
curl http://localhost:7777/api/crucible/metrics

# Per-agent metrics
curl http://localhost:7777/api/crucible/metrics/{agentId}
```

Can be aggregated with other app metrics.

## Security Considerations

### Network Restriction

Crucible validates on startup:
```typescript
if (network === 'mainnet') {
  throw new Error('❌ FATAL: Crucible cannot run on mainnet');
}
```

Hard-coded prevention of mainnet deployment.

### Fund Recovery

All exploited funds automatically recover to guardian address:
```bash
GUARDIAN_ADDRESS_LOCALNET=0x71562b71999873DB5b286dF957af199Ec94617F7
```

### Isolation

Crucible agents operate in isolated contexts:
- Separate database tables
- Dedicated wallets
- No access to production systems
- All activity logged

## Troubleshooting

### "Crucible not starting with bun run dev"

Check:
1. Is `autoStart: true` in manifest?
2. Is localnet running?
3. Are contracts deployed?
4. Is AI API key configured?

### "Docker container can't reach localnet"

Check:
1. Using `host.docker.internal` in RPC URL?
2. Is Docker Desktop configured to share network?
3. Try: `docker run --rm curlimages/curl curl http://host.docker.internal:9545`

### "Agents not funded"

Run from repo root:
```bash
cd apps/crucible && bun run fund
```

Or use deployment script:
```bash
cd apps/crucible && bun run deploy
```

## Best Practices

1. **Development**: Run locally (`bun run dev`)
   - Faster iteration
   - Direct log access
   - Easier debugging

2. **Testing**: Run in Docker
   - Consistent environment
   - Network isolation
   - Production-like setup

3. **CI/CD**: Use Docker
   - Reproducible builds
   - Container registry
   - Deployment automation

## See Also

- [SETUP.md](../SETUP.md) - Complete setup guide
- [README.md](../README.md) - Architecture and features
- [X402_PROTOCOL.md](X402_PROTOCOL.md) - Payment protocol
- [PAYMASTER.md](PAYMASTER.md) - Gas abstraction

