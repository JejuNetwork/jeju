# Apps

Core Jeju applications.

## Structure

```
apps/
├── bazaar/       # DeFi + NFT marketplace
├── gateway/      # Bridge, paymasters, staking
├── indexer/      # GraphQL blockchain indexer
├── ipfs/         # Decentralized storage
├── compute/      # Compute marketplace
└── documentation # Docs site
```

## Start

```bash
bun run dev
```

All apps with `autoStart: true` start automatically.

## Add an App

1. Create `apps/my-app/jeju-manifest.json`:

```json
{
  "name": "my-app",
  "type": "core",
  "commands": { "dev": "bun run dev" },
  "ports": { "main": 4020 },
  "autoStart": true
}
```

2. Run `bun run dev`

## Ports

| App | Port |
|-----|------|
| Gateway | 4001 |
| Bazaar | 4006 |
| Indexer | 4350 |

Override: `GATEWAY_PORT=5001 bun run dev`
