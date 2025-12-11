# Jeju Token ICO

Public token sale platform for the Jeju Network JEJU token.

```bash
bun run dev
```

http://localhost:4020

## ICO Structure

**Sale Type:** Uniswap Continuous Clearing Auction (CCA)

| Metric | Value |
|--------|-------|
| Sale Allocation | 10% (1B tokens) |
| Soft Cap | $3M |
| Auction Duration | 7 days |
| TGE Unlock | 20% |
| Vesting | 180-day linear |

See [ICO_PLAN.md](./ICO_PLAN.md) for full details.

## Features

- CCA auction with market-driven pricing
- Tokenomics visualization
- Whitepaper with MiCA compliance
- Paymaster support (any token)

## Token Utility

**Exclusive (JEJU only):**
- Governance voting
- Moderation staking
- Ban enforcement

**Universal (any paymaster token):**
- Compute services
- Storage services
- Marketplace fees

## Config

```env
NEXT_PUBLIC_NETWORK=testnet|mainnet|localnet
NEXT_PUBLIC_PRESALE_ADDRESS=0x...
```

## Test

```bash
bun test              # Unit tests
bun run test:e2e      # Playwright E2E
bun run test:synpress # Wallet integration
```

## Deploy

```bash
cd packages/contracts
forge script script/DeployPresale.s.sol --rpc-url $RPC_URL --broadcast
```

## Fork

1. Update `src/config/tokenomics.ts`
2. Update `ICO_PLAN.md`
3. Deploy contracts
4. Update `src/config/presale.ts`

MIT
