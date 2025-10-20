# Bazaar - Jeju DeFi + NFT Marketplace

Unified token launchpad, Uniswap V4 swaps, liquidity pools, and NFT marketplace on Jeju.

## Features

🪙 **Token Launchpad**
- Create and deploy ERC20 tokens
- Automatic indexing and discovery
- Real-time price tracking
- Multi-chain support (EVM + Solana ready)

🔄 **Uniswap V4 Integration**
- Token swaps with custom hooks
- Liquidity provision
- Pool creation and management
- Advanced routing

🖼️ **NFT Marketplace**
- Browse and trade NFTs
- View owned NFTs
- List NFTs for sale
- Collection grouping

🎮 **Game Integration**
- ERC-8004 registered games
- A2A protocol support
- Game discovery and filtering
- Player statistics

## Getting Started

### Prerequisites
- Bun >= 1.2.0
- Node >= 18.0.0

### Installation

```bash
bun install
```

### Development

```bash
bun run dev
```

Server runs on http://localhost:4006

### Build

```bash
bun run build
```

### Production

```bash
bun run start
```

## Testing

See [TESTING.md](./TESTING.md) for complete testing documentation.

### Quick Start

```bash
# Run all tests
bun run test

# Unit tests only
bun run test:unit

# E2E tests only
bun run test:e2e

# Wallet integration tests (requires headed browser)
bun run test:wallet
```

### Test Coverage

- **15 unit tests** - Configuration, utilities, ban checking
- **54 E2E tests** - All routes, forms, navigation
- **15 wallet tests** - Full user journeys with MetaMask/Dappwright

All tests passing ✅

## Architecture

### Frontend Stack
- **Next.js 14** - React framework with App Router
- **React 19** - Latest React features
- **Wagmi 2** - Ethereum wallet connection
- **Viem 2** - Low-level Ethereum interactions
- **TanStack Query** - Data fetching and caching
- **Tailwind CSS** - Styling
- **Radix UI** - Accessible UI components
- **Sonner** - Toast notifications

### Key Integrations
- **Uniswap V4 SDK** - DEX functionality
- **Solana Web3.js** - Solana chain support (ready)
- **Jeju Indexer** - GraphQL API for on-chain data
- **Jeju Network** - L3 settlement layer

### Routes

- `/` - Homepage with feature overview
- `/tokens` - Token listing and discovery
- `/tokens/create` - Launch new ERC20 tokens
- `/tokens/[chainId]/[address]` - Token detail page
- `/swap` - Uniswap V4 token swapping
- `/pools` - Liquidity pool overview
- `/liquidity` - Add/remove liquidity
- `/nfts` - NFT marketplace
- `/my-nfts` - User's owned NFTs
- `/games` - ERC-8004 registered games

### API Routes

- `/api/a2a` - Agent-to-Agent protocol endpoint
- `/.well-known/agent-card.json` - Agent discovery

## Configuration

### Environment Variables

Create `.env.local`:

```bash
# Wallet Connect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id

# Jeju Network
NEXT_PUBLIC_CHAIN_ID=1337
NEXT_PUBLIC_RPC_URL=http://localhost:9545

# Indexer
NEXT_PUBLIC_INDEXER_URL=http://localhost:4350/graphql

# Moderation (optional)
NEXT_PUBLIC_BAN_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=0x...

# Uniswap V4 Contracts
NEXT_PUBLIC_POOL_MANAGER=0x...
NEXT_PUBLIC_SWAP_ROUTER=0x...
```

### Chain Configuration

See `config/chains.ts` for Jeju network configuration:
- Localnet: Chain ID 1337 (port 9545)
- Testnet: Chain ID 420690 (Base Sepolia)  
- Mainnet: Chain ID 420691 (Base)

### Contract Configuration

See `config/contracts.ts` for deployed contract addresses:
- V4 Pool Manager
- Swap Router
- Position Manager
- NFT marketplace contracts

## Development

### Code Quality

```bash
# Linting
bun run lint

# Type checking
bun run typecheck

# All checks
bun run lint && bun run typecheck && bun run test
```

### Adding Features

1. **New Route**: Add page in `app/`
2. **New Component**: Add to `components/`
3. **New Utility**: Add to `lib/`
4. **Tests**: Add corresponding tests

### Conventions

- Use Bun for all operations (not npm/npx)
- TypeScript strict mode
- Functional components with hooks
- Tailwind for styling
- Server components by default (use 'use client' when needed)

## Integration with Jeju Ecosystem

### Indexer Integration
- Real-time token discovery
- Transaction history
- Token holder tracking
- Pool analytics

### Moderation Integration
- Ban checking before trades
- Reputation badges on profiles
- Report system integration
- Network-wide and app-specific bans

### Identity Registry
- Automatic agent registration
- Address-to-AgentID mapping
- Profile management

## Deployment

### Development
```bash
bun run dev
```

### Production Build
```bash
bun run build
bun run start
```

### Docker (Optional)
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run build
EXPOSE 4006
CMD ["bun", "run", "start"]
```

## Monitoring

### Health Checks
- `/` - Homepage should return 200
- `/api/health` - API health endpoint (if implemented)

### Performance
- Lighthouse score target: > 90
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s

## Troubleshooting

### Common Issues

**Port 4006 already in use**
```bash
lsof -ti:4006 | xargs kill -9
```

**Wallet not connecting**
- Check WalletConnect project ID
- Verify Jeju RPC URL is accessible
- Ensure correct chain ID

**GraphQL errors**
- Verify indexer is running on port 4350
- Check indexer health: `curl http://localhost:4350/health`

**Tests failing**
- Ensure dev server is running
- Clear browser cache
- Check playwright browsers installed: `bunx playwright install`

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new features
4. Ensure all tests pass: `bun run test`
5. Submit pull request

## License

MIT
