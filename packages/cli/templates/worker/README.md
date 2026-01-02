# {{DISPLAY_NAME}}

A Jeju Network worker deployed to DWS (Decentralized Web Services).

## Quick Start

```bash
# Install dependencies
bun install

# Start development server with hot reload
bun run dev

# Build for production
bun run build

# Deploy to Jeju Network
bun run deploy
```

## Development

The worker runs locally on port 8787 by default:

```bash
# Health check
curl http://localhost:8787/health

# API endpoints
curl http://localhost:8787/api/items
curl -X POST http://localhost:8787/api/items -H "Content-Type: application/json" -d '{"name":"test"}'
```

## Deployment

Deploy to Jeju Network with the CLI:

```bash
# Login first
jeju login

# Deploy
jeju publish
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 8787 |
| `NETWORK` | Network (localnet/testnet/mainnet) | localnet |

## Project Structure

```
{{APP_NAME}}/
├── api/
│   └── worker.ts      # Main worker entry point
├── jeju-manifest.json # DWS deployment config
├── package.json
└── tsconfig.json
```

## License

MIT
