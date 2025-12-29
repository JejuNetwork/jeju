# Example

A Todo application demonstrating Jeju Network services.

## Quick Start

```bash
bun install
bun run dev
```

- Frontend: http://localhost:4501
- Backend: http://localhost:4500

## API Endpoints

- REST API: `/api/v1`
- A2A: `/a2a`
- MCP: `/mcp`
- x402: `/x402`
- Auth: `/auth`
- Health: `/health`
- Agent Card: `/a2a/.well-known/agent-card.json`

## Testing

```bash
bun run test
```

## Deployment

```bash
bun run build
bun run deploy
```

For testnet:
```bash
NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... bun run deploy
```

## Authentication

Authenticated requests require:
```
x-jeju-address: <wallet address>
x-jeju-timestamp: <unix timestamp ms>
x-jeju-signature: <signature of "jeju-dapp:{timestamp}">
```

## License

MIT
