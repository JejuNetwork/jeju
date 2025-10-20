# Jeju Core Apps

This directory contains core applications that are part of the Jeju ecosystem.

## Structure

Each app has its own `jeju-manifest.json`:

```
apps/
├── README.md
├── bazaar/          # Unified DeFi + NFT marketplace
├── crucible/        # Cross-chain asset forge
├── documentation/   # VitePress documentation site
├── ehorse/          # Horse racing prediction game
├── gateway/         # Protocol infrastructure hub
├── indexer/         # Subsquid blockchain indexer
├── ipfs/            # Decentralized file storage (x402 payments, A2A agent)
├── leaderboard/     # Leaderboard + TEE verification
├── monitoring/      # Prometheus + Grafana stack
├── predimarket/     # Prediction market platform
└── ...
```

## Manifest Format

All apps use the unified `jeju-manifest.json` format:

```json
{
  "name": "my-app",
  "displayName": "My App",
  "version": "1.0.0",
  "type": "core",
  "description": "My core application",
  "commands": {
    "dev": "bun run dev",
    "build": "bun run build",
    "start": "bun run start"
  },
  "ports": {
    "main": 4006,
    "api": 4007
  },
  "dependencies": ["contracts", "config"],
  "optional": false,
  "enabled": true,
  "autoStart": true,
  "tags": ["defi", "marketplace"]
}
```

## Discovery

Core apps are automatically discovered and started by `bun run dev`.

The manifest system provides:
- ✅ Automatic app discovery (no hardcoded lists)
- ✅ Port configuration via manifest
- ✅ Dependency declaration
- ✅ Optional vs required apps
- ✅ Auto-start control
- ✅ Environment variable injection

## Core vs Vendor

- **Core Apps** (`type: "core"`): Essential Jeju applications in `apps/`
- **Vendor Apps** (`type: "vendor"`): Third-party applications in `vendor/`

Both use the same manifest format and discovery system.

## List Apps

```bash
bun run apps:list    # List all apps (core + vendor)
```

## Development

All apps automatically get:
- `JEJU_RPC_URL` - RPC endpoint (http://localhost:9545)
- `CHAIN_ID` - Chain ID (1337 for localnet)
- Port environment variables (e.g., `BAZAAR_PORT`)
- Access to shared types from `/types`
- Access to contract deployments from `/contracts/deployments`

## Adding a New Core App

1. Create directory: `apps/my-app/`
2. Add `jeju-manifest.json` with `"type": "core"`
3. Add `package.json` with dev/build/start scripts
4. Run `bun run dev` - your app will auto-start!

## Manifest Schema

See `/jeju-manifest.schema.json` for the complete schema definition.

