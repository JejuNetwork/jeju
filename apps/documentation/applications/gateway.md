# Gateway

Protocol infrastructure portal.

**URL**: http://127.0.0.1:4001 | https://gateway.jeju.network

## Features

| Feature | Description |
|---------|-------------|
| Bridge | EIL cross-chain + OP bridge |
| Token Registry | Register tokens for gas |
| Staking | Provide liquidity, earn fees |
| Node Staking | Run nodes, earn rewards |
| App Registry | ERC-8004 agent registration |

## Bridge

### Deposit (Ethereum → Jeju)

1. Go to /bridge
2. Select token and amount
3. Confirm transaction
4. Receive on Jeju (~2 min)

### EIL Fast Bridge

Uses XLP liquidity for instant transfers:
1. Toggle "Fast Mode"
2. XLP fulfills instantly

### Withdraw

- Standard: 7-day challenge period
- Fast: ~15 min via XLP

## Staking

1. Go to /stake
2. Enter ETH/token amount
3. Click "Stake"

Earn 50% of paymaster fees.

## Token Integration

1. Go to /tokens/register
2. Enter token address
3. Set oracle and fee range
4. Pay 0.1 ETH registration

## Node Staking

Requirements:
- 8+ cores, 16GB RAM, 500GB SSD
- Stake any registered token
- Public RPC endpoint

## Development

```bash
cd apps/gateway
bun install
bun run dev
```
