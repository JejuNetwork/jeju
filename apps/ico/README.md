# Jeju Token Presale

Token presale application for the Jeju Network JEJU token.

## Quick Start

```bash
cd apps/ico
bun install
bun run dev
```

Open [http://localhost:4020](http://localhost:4020).

## Features

- **Presale Interface**: Contribute ETH to receive JEJU tokens
- **Real-time Countdown**: Live countdown to presale phases
- **Tokenomics Display**: Visual breakdown of token allocation
- **Whitepaper**: Full technical documentation with MiCA compliance
- **Vesting Calculator**: See unlock schedule for your tokens

## Presale Phases

1. **Whitelist Sale** (Week 1-2): 10% bonus for whitelisted participants
2. **Public Sale** (Week 3-4): Open participation with volume bonuses
3. **TGE** (Week 5): 20% unlock, trading begins
4. **Vesting**: 180-day linear vesting for remaining tokens

## Token Utility

- **Governance**: Vote on protocol proposals
- **Moderation**: Stake in the futarchy moderation marketplace
- **Network Services**: Pay for compute, storage via paymaster
- **Agent Council**: Revenue funds network operations

## Configuration

Environment variables (optional):

```env
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_PRESALE_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_ADDRESS=0x...
```

## Testing

```bash
# Unit tests
bun test

# E2E tests (requires running dev server)
bun run test:e2e
```

## Deployment

Deploy the presale contract first:

```bash
cd packages/contracts
forge script script/DeployPresale.s.sol --rpc-url $RPC_URL --broadcast
```

Then update the contract address in `src/config/presale.ts`.

## Fork This

This presale app is designed to be forked for other tokens. To use it:

1. Fork the repository
2. Update `src/config/tokenomics.ts` with your token details
3. Deploy your own presale contract
4. Update addresses in `src/config/presale.ts`
5. Customize branding in `src/app/layout.tsx`

## License

MIT
