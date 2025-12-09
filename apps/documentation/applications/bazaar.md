# Bazaar

DeFi, NFTs, and Prediction Markets.

**URL**: http://127.0.0.1:4006 | https://bazaar.jeju.network

## Features

| Feature | Description |
|---------|-------------|
| Token Launchpad | Deploy ERC20s with bonding curves |
| DEX | Uniswap V4 swaps |
| Liquidity | Concentrated liquidity positions |
| Prediction Markets | LMSR market maker |
| NFT Marketplace | Browse and trade NFTs |

## Routes

| Route | Purpose |
|-------|---------|
| `/tokens` | Token discovery |
| `/tokens/create` | Launch tokens |
| `/swap` | Token swaps |
| `/pools` | Liquidity |
| `/markets` | Prediction markets |
| `/portfolio` | Your positions |
| `/nfts` | NFT marketplace |

## Development

```bash
cd apps/bazaar
bun install
bun run dev
```

## Testing

```bash
bun run test        # All tests
bun run test:e2e    # E2E tests
```
