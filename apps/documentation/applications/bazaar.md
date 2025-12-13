# Bazaar

Bazaar is Jeju's economic hub — a full-featured DeFi application with token swaps, liquidity pools, NFT marketplace, token launchpad, and JNS name trading. It's built on Uniswap V4 and designed for 200ms block times.

**URLs:** Localnet at http://127.0.0.1:4006, testnet at https://bazaar-testnet.jeju.network, mainnet at https://bazaar.jeju.network

## Token Swapping

Bazaar uses Uniswap V4 for token swaps with several Jeju-specific enhancements.

### How Swaps Work

When you initiate a swap, Bazaar finds the best route through available pools, shows you a preview with the quote, then executes the swap when you confirm. The pool manager handles the actual token transfer.

### Using the Swap

Navigate to `/swap`, select your input token (what you're selling) and output token (what you're buying), enter the amount, then review the price, price impact, route, and minimum received amount. Click "Swap" and confirm in your wallet.

### Swap Settings

Slippage defaults to 0.5% and controls the maximum price movement before the transaction reverts. Deadline defaults to 30 minutes and specifies when the transaction expires. MEV Protection routes through a private mempool when enabled.

### Multi-hop Routing

If there's no direct pool between tokens, Bazaar automatically finds the optimal route through multiple pools. For example, USDC might route through ETH to reach JEJU. The router finds the cheapest path automatically.

## Liquidity Pools

Provide liquidity to earn trading fees. Bazaar uses Uniswap V4's concentrated liquidity.

### Understanding Concentrated Liquidity

Unlike Uniswap V2 where liquidity spreads across the entire price range, V4 lets you concentrate liquidity in specific price ranges. If ETH/USDC trades between $2,000-$2,500, concentrating liquidity there earns more fees than spreading it from $0 to infinity.

### Creating a Position

Navigate to `/pools`, click "New Position", select the token pair, then choose a fee tier: 0.05% for stable pairs like USDC/USDT, 0.3% for standard pairs like ETH/USDC, or 1% for exotic pairs with smaller tokens.

Set your price range — either full range (like V2, earning on any price) or custom (set min/max prices for a concentrated position). Enter amounts for each token and click "Add Liquidity".

### Managing Positions

Your positions appear on the Pools page. For each position you can add liquidity, remove liquidity, collect fees, or adjust the range. Each liquidity position is an NFT, making positions tradeable and usable as collateral.

### Impermanent Loss

When you provide liquidity, the pool rebalances as prices change. If price moves significantly, you may end up with less value than if you had simply held the tokens. Fees earned may offset this loss, especially in high-volume pools.

## NFT Marketplace

Buy, sell, and auction NFTs natively on Jeju.

### Listing an NFT

Navigate to `/nft`, connect your wallet, click "List", select an NFT from your wallet, then choose the sale type. Fixed Price sets an exact price for instant purchase. Auction creates a timed bidding period. Set your price or starting bid, choose the listing duration, and confirm.

### Buying NFTs

Navigate to `/nft`, browse or search collections, click on an NFT, then click "Buy Now" for fixed price or "Place Bid" for auctions. Confirm the transaction in your wallet.

### Auctions

Auctions run for a set duration. Bidders lock funds with each bid. If outbid, your previous bid is refunded. The highest bid wins when the auction ends — the winner receives the NFT and the seller receives payment.

### Royalties

Creators can set royalties (typically 2.5-10%) on secondary sales. Royalties are paid automatically on each sale.

## Token Launchpad

Create and launch new tokens with automated liquidity.

### Bonding Curves

Instead of traditional liquidity, the launchpad uses bonding curves. Early buyers get lower prices, and the price rises with each purchase. Linear curves increase price proportionally with supply, while exponential curves accelerate price as supply runs out.

### Creating a Token

Navigate to `/launchpad`, click "Create Token", enter the name, symbol, initial supply, description, and logo. Pay the creation fee and your token is deployed and tradeable immediately.

### Launching with Bonding Curve

For a proper launch with price discovery, navigate to `/launchpad`, click "Launch Token", configure the target raise amount, curve type (linear or exponential), and initial price. When the launch hits its target, the bonding curve closes, collected ETH plus proportional tokens go to a Uniswap pool, and the initial liquidity is locked.

### Participating in a Launch

Navigate to `/launchpad`, browse active launches, select one, enter your ETH contribution, and receive tokens at the current curve price. You can sell back anytime since bonding curves work both ways.

## JNS Names (.jeju)

Jeju Name Service provides human-readable names for addresses. Instead of `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`, use `alice.jeju`.

### What JNS Does

JNS names resolve to wallet addresses, content hashes (IPFS), and text records (Twitter, Discord, etc.).

### Registering a Name

Navigate to `/names`, search for your desired name. If available, select a duration (1-5 years) and pay the registration fee. Pricing varies by length: 3-character names cost 0.1 ETH per year, 4-character names cost 0.05 ETH, and 5+ character names cost 0.01 ETH. Shorter names cost more due to scarcity.

### Managing Your Name

Navigate to `/names/my` to set your primary address, set reverse resolution (so your address displays your name), add text records like Twitter handle and Discord username, or set a content hash pointing to an IPFS website.

### Trading Names

JNS names are ERC-721 NFTs. You can list them on the Bazaar NFT marketplace, transfer directly to another address, or use them as collateral in DeFi.

## Prediction Markets

Trade on the outcomes of future events.

### How They Work

Each market has YES and NO tokens. If the outcome is YES, YES tokens are worth $1 and NO tokens are worth $0 (and vice versa). Current prices represent probability — YES trading at $0.70 means 70% probability.

### Creating a Market

Navigate to `/markets`, click "Create Market", enter the question, resolution criteria, end date, and resolution source (oracle, DAO vote, or designated resolver). Add initial liquidity and create the market.

### Trading

Navigate to `/markets`, select a market, choose YES or NO, enter your amount, and trade. Prices move based on supply and demand like any other token.

### Resolution

When the event occurs, the resolver submits the outcome. After a 24-hour dispute period, the market finalizes and winners can redeem at $1 per share.

## Agent Integration (A2A)

Agents can interact with Bazaar using these skills: `swap` for exchanging tokens, `add_liquidity` for adding to pools, `remove_liquidity` for exiting positions, `list_nft` for listing NFTs, `buy_nft` for purchasing NFTs, and `register_name` for registering JNS names.

```bash
curl -X POST http://localhost:4006/api/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "swap",
      "parameters": {
        "tokenIn": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "tokenOut": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "amountIn": "1000000000",
        "slippage": 0.5
      }
    }
  }'
```

## Setup & Configuration

Install with `cd apps/bazaar && bun install`.

Create `.env.local` with `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (required), `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_RPC_URL`, and `NEXT_PUBLIC_INDEXER_URL`.

Run development with `bun run dev`. For production, run `bun run build` then `bun run start`.

## Testing

Run all tests with `bun run test`, unit tests with `bun run test:unit`, E2E tests with `bun run test:e2e`, and wallet tests with `bun run test:wallet`.

## Deployment

### Localnet

Bazaar starts automatically with `bun run dev` from the root.

### Testnet/Mainnet

Build the production bundle:

```bash
bun run build
```

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=bazaar sync
```

### Required Secrets for Production

Configure in AWS Secrets Manager or environment:
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — WalletConnect project ID
- `NEXT_PUBLIC_ALCHEMY_API_KEY` — Alchemy API key (optional, for enhanced RPC)
- Contract addresses are loaded from `packages/config/contracts.json`

### Docker

```bash
docker build -t jeju-bazaar .
docker run -p 4006:4006 -e NEXT_PUBLIC_NETWORK=testnet jeju-bazaar
```

## Common Issues

"Insufficient liquidity" means there's not enough liquidity in pools for your trade size. Try a smaller amount, higher slippage, or a different route.

"Price impact too high" means your trade is too large relative to pool size. Consider breaking into smaller trades or waiting for more liquidity.

"Transaction expired" means the deadline passed before the transaction confirmed. The network may be congested — increase the deadline or gas.

## Next Steps

- [DeFi Contracts](/build/contracts/overview) — Uniswap V4 integration
- [GraphQL API](/reference/api/graphql) — Query marketplace data
