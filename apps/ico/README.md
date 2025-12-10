# Jeju Token Presale

```bash
bun run dev
```

http://localhost:4020

## Features

- Presale with whitelist/public phases
- Tokenomics chart
- Whitepaper with MiCA compliance

## Phases

1. Whitelist (10% bonus)
2. Public (volume bonuses)
3. TGE (20% unlock)
4. 180-day vesting

## Config

```env
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_PRESALE_ADDRESS=0x...
```

## Test

```bash
bun test
bun run test:e2e
```

## Deploy

```bash
cd packages/contracts
forge script script/DeployPresale.s.sol --rpc-url $RPC_URL --broadcast
```

Update addresses in `src/config/presale.ts`.

## Fork

1. Update `src/config/tokenomics.ts`
2. Deploy contract
3. Update `src/config/presale.ts`

MIT
