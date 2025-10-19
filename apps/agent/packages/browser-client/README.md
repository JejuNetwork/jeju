# ElizaOS Browser Client

Run autonomous ElizaOS agents directly in your browser with full ERC-8004 registry integration.

## Features

- ✅ **No Installation Required** - Runs entirely in browser
- ✅ **WebContainer Sandbox** - Isolated Node.js environment
- ✅ **IndexedDB Storage** - Persistent local database
- ✅ **Registry Integration** - Discover and connect to apps
- ✅ **PWA Support** - Install as standalone app
- ✅ **Offline Capable** - Works without internet (with local models)

## Quick Start

```bash
# Development
cd apps/agent/packages/browser-client
bun install
bun run dev

# Open http://localhost:4010
```

## Production Build

```bash
bun run build
bun run preview
```

## Architecture

```
┌─────────────────────────────────────┐
│   Browser Tab                        │
│  ┌───────────────────────────────┐ │
│  │ React UI (main thread)        │ │
│  └─────────┬─────────────────────┘ │
│            │                         │
│  ┌─────────▼─────────────────────┐ │
│  │ WebContainer (sandboxed Node) │ │
│  │ - ElizaOS Runtime             │ │
│  │ - Plugin-Registry             │ │
│  │ - Agent Logic                 │ │
│  └─────────┬─────────────────────┘ │
│            │                         │
│  ┌─────────▼─────────────────────┐ │
│  │ IndexedDB (persistent)        │ │
│  │ - Memories                    │ │
│  │ - State                       │ │
│  │ - Cache                       │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────┐
│   Jeju Network (via RPC)             │
│  - IdentityRegistry Contract        │
│  - Discover Apps                    │
│  - Fetch A2A Endpoints              │
└─────────────────────────────────────┘
```

## Deployment

### GitHub Pages

```bash
# Build
bun run build

# Deploy to gh-pages
npm install -g gh-pages
gh-pages -d dist
```

### Vercel

```bash
vercel deploy
```

### IPFS

```bash
# Install IPFS CLI
npm install -g ipfs

# Add to IPFS
ipfs add -r dist
```

## Configuration

Set environment variables in `.env.local`:

```bash
VITE_RPC_URL=https://rpc.jeju.network
VITE_IDENTITY_REGISTRY_ADDRESS=0x...
VITE_AGENT_NAME=MyBrowserAgent
```

## Limitations

- WebContainer requires modern browsers (Chrome 109+, Edge 109+)
- File system is limited to 120MB
- No native OS access (by design for security)
- Some npm packages may not work (those requiring native modules)

## Security

- Runs in browser sandbox (no access to OS)
- All data stored locally in IndexedDB
- No secrets transmitted to servers
- User controls all permissions

## License

MIT

