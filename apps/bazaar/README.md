# Bazaar - Jeju's Unified DeFi + NFT + Token Launchpad

**The complete trading and creation experience on Jeju L3**

Bazaar consolidates token creation & launchpad, Uniswap V4 swapping, liquidity provision, and NFT marketplace functionality into a single, seamless interface.

---

## Features

### 🪙 Token Launchpad (Multi-Chain)
- Create ERC20 tokens on Jeju (and optionally Solana, BSC, Base, Ethereum)
- Automatic indexing via Jeju blockchain indexer
- Real-time token tracking and analytics
- Bonding curve support (coming soon)
- Token verification system

### 🔄 Token Swaps (Uniswap V4)
- Swap any ERC-20 tokens on Jeju
- Powered by Uniswap V4 with hooks
- Real-time quotes and price impact calculation
- Slippage protection

### 💧 Liquidity Pools
- Provide liquidity to V4 pools
- Create new pools with custom hooks
- Manage positions
- Earn trading fees

### 🖼️ NFT Marketplace
- Browse and purchase NFTs
- List your NFTs for sale
- View your collection
- Trade Hyperscape items, game assets, and more

---

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Blockchain:** Viem 2.30 + Wagmi 2.15
- **Multi-Chain:** Solana Web3.js, Wallet Adapters
- **Styling:** Tailwind CSS
- **State:** TanStack Query
- **Protocol:** Uniswap V4 SDK
- **Indexing:** Subsquid GraphQL API
- **Testing:** Playwright + Dappwright

---

## Getting Started

### Prerequisites

- Bun >= 1.2.0
- Jeju localnet running (`bun run dev` from project root)
- MetaMask or compatible wallet

### Installation

```bash
cd apps/bazaar
bun install
```

### Development

```bash
bun run dev
```

App will be available at http://localhost:4006

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

---

## Project Structure

```
apps/bazaar/
├── app/                    # Next.js app router pages
│   ├── tokens/             # Token listing and creation
│   │   ├── create/         # Token creation page
│   │   └── [chainId]/[address]/ # Token detail with trading
│   ├── swap/               # Token swap page
│   ├── pools/              # Liquidity pools page
│   ├── nfts/               # NFT marketplace page
│   └── my-nfts/            # User's NFT collection
├── components/             # Reusable React components
├── hooks/                  # Custom React hooks
├── config/                 # Chain, contracts, tokens configuration
│   ├── multi-chain.ts      # Multi-chain support (Jeju, BSC, Base, Solana)
│   └── ...
├── lib/                    # Utility functions
│   ├── indexer-client.ts   # GraphQL client for blockchain data
│   └── ...
├── types/                  # TypeScript types
│   ├── token.ts            # Token types and interfaces
│   └── ...
└── tests/                  # E2E tests with Playwright
    └── e2e/                # End-to-end test specs

```

---

## Configuration

### Jeju Chain

Configured in `config/chains.ts`:
- Chain ID: 420691
- RPC URL: http://localhost:9545 (localnet)
- Explorer: http://localhost:4004

### Contracts

Reads from `/contracts/deployments/uniswap-v4-420691.json`:
- PoolManager
- WETH
- SwapRouter (when deployed)
- PositionManager (when deployed)
- QuoterV4 (when deployed)

### Tokens

Configured in `/config/jeju-tokens.json`:
- ETH (native)
- WETH
- USDC
- elizaOS
- Other Jeju tokens

---

## Development Workflow

1. **Start Jeju localnet**
   ```bash
   cd /Users/shawwalters/jeju
   bun run dev
   ```

2. **Start Bazaar**
   ```bash
   cd apps/bazaar
   bun run dev
   ```

3. **Configure MetaMask**
   - Network: Jeju Localnet
   - RPC: http://localhost:9545
   - Chain ID: 420691

4. **Import test account**
   - Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

---

## Features by Page

### Home (`/`)
- Welcome screen
- Feature cards for all services
- Quick navigation to tokens, swap, pools, NFTs

### Tokens (`/tokens`)
- Browse all tokens on Jeju
- Filter by verified, new, all
- Real-time data from indexer
- Multi-chain support (Jeju, BSC, Base, Solana)

### Token Creation (`/tokens/create`)
- Create ERC20 tokens on Jeju
- Automatic indexing and listing
- Optional bonding curve
- Multi-chain deployment support

### Token Detail (`/tokens/[chainId]/[address]`)
- Token information and stats
- Buy/sell trading interface
- Recent transfers feed
- Top holders list
- Real-time data from blockchain indexer

### Swap (`/swap`)
- Token input/output selection
- Real-time quotes
- Price impact warnings
- Slippage settings
- Execute swaps

### Pools (`/pools`)
- Browse all V4 pools
- View pool analytics
- Add liquidity
- Create new pools
- Manage positions

### NFT Marketplace (`/nfts`)
- Browse all listed NFTs
- Filter by collection
- Purchase NFTs
- View details

### My NFTs (`/my-nfts`)
- View owned NFTs
- List NFTs for sale
- Manage listings
- Transfer NFTs

---

## Integration

### With Jeju Dev Script

Bazaar is automatically started with `bun run dev` from project root.

Port: **4006**

### With Contracts

Reads directly from:
- `/contracts/deployments/` - Deployed contract addresses
- `/config/jeju-tokens.json` - Token list

### With Other Apps

Shares:
- Same wallet connection
- Same contract addresses  
- Same token list
- Same RPC configuration

---

## Testing

### E2E Tests (Playwright + Dappwright)

```bash
# Run all tests
bun run test

# Run with UI
bun run test:ui

# Run in headed mode  
bun run test:headed
```

**Test Coverage:**
- ✅ Homepage navigation and feature cards
- ✅ Token listing page with filters
- ✅ Token creation form validation
- ✅ Token detail page display
- ✅ Wallet connection flow (with MetaMask)

### Manual Testing Checklist

1. **Tokens**
   - Browse tokens on `/tokens`
   - Create new token on `/tokens/create`
   - View token details with transfers and holders
   - Test buy/sell (when implemented)

2. **DeFi**
   - Swap tokens on `/swap`
   - Add liquidity on `/pools`
   - View pool analytics

3. **NFTs**
   - Browse NFT marketplace
   - View NFT details
   - Manage owned NFTs

---

## Deployment

### Build for Production

```bash
bun run build
```

### Deploy

Can be deployed to:
- Vercel
- Netlify
- Cloudflare Pages
- Any static hosting

---

## Troubleshooting

### Wallet Won't Connect
- Ensure Jeju localnet is running
- Check MetaMask network configuration
- Verify RPC URL is correct

### Contracts Not Found
- Check deployments exist in `/contracts/deployments/`
- Verify addresses in config files
- Deploy missing contracts

### App Won't Start
- Run `bun install`
- Check Node/Bun version
- Clear `.next` cache

---

## Contributing

This is a core Jeju app. Improvements welcome!

1. Create feature branch
2. Make changes
3. Test locally
4. Submit PR

---

## License

MIT

---

**Built for the Jeju ecosystem** 🏝️

