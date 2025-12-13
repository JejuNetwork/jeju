# Cross-Chain Intents

Express what you want, not how to get it.

## The Problem

Cross-chain today is painful:
1. Find a bridge
2. Approve tokens
3. Bridge (wait 10-30 min)
4. Claim on destination
5. Swap if needed
6. Finally do what you wanted

## Jeju's Solution

**Intents**: Declare your desired outcome, let solvers handle the rest.

```
User: "I want 100 USDC on Jeju"
       ↓
Solver: "I'll give you 100 USDC on Jeju, 
         you give me 100.05 USDC on Arbitrum"
       ↓
User: Signs intent
       ↓
Solver: Fills instantly
       ↓
Done. User has USDC on Jeju.
```

## How It Works

### Step 1: User Creates Intent

```typescript
// On any supported chain
await inputSettler.createIntent({
  sourceChain: ARBITRUM,
  destinationChain: JEJU,
  tokenIn: USDC_ARBITRUM,
  tokenOut: USDC_JEJU,
  amountIn: parseUnits("100.05", 6),
  minAmountOut: parseUnits("100", 6),
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  recipient: userAddress, // On Jeju
});
```

### Step 2: Solver Sees Intent

Solvers monitor via Indexer or WebSocket:

```typescript
const intents = await indexer.query(`{
  openIntents(where: { 
    destinationChain: 420691,
    status: "PENDING" 
  }) {
    id
    tokenIn
    tokenOut
    amountIn
    minAmountOut
  }
}`);
```

### Step 3: Solver Fills

```typescript
// On Jeju
await outputSettler.fillIntent(
  intentId,
  parseUnits("100", 6), // Exact output
);
```

### Step 4: Oracle Verifies

Oracles attest that the source chain deposit exists.

### Step 5: Solver Claims

```typescript
// On source chain (Arbitrum)
await inputSettler.claimPayment(intentId);
```

## Architecture

```
Source Chain (Arbitrum)              Destination Chain (Jeju)
┌─────────────────────┐              ┌─────────────────────┐
│                     │              │                     │
│   InputSettler      │              │   OutputSettler     │
│   - createIntent()  │              │   - fillIntent()    │
│   - claimPayment()  │              │                     │
│                     │              │                     │
└──────────┬──────────┘              └──────────┬──────────┘
           │                                    │
           │         SolverRegistry             │
           │         (on Jeju)                  │
           │              │                     │
           └──────────────┼─────────────────────┘
                          │
                    ┌─────▼─────┐
                    │  Indexer  │
                    │ + Oracle  │
                    └───────────┘
```

## Supported Chains

| Chain | InputSettler | Status |
|-------|--------------|--------|
| Ethereum | ✅ | Live |
| Base | ✅ | Live |
| Arbitrum | ✅ | Live |
| Optimism | ✅ | Live |
| Polygon | 🔜 | Coming |

## For Users

Just use the [Gateway](https://gateway.jeju.network):

1. Connect wallet
2. Select source chain and token
3. Enter amount
4. Click "Bridge"

Fastest route is selected automatically.

## For Solvers

Become a solver to earn from spreads:

```bash
# Register as solver
cast send $SOLVER_REGISTRY "register()" \
  --value 0.5ether \
  --rpc-url https://rpc.jeju.network
```

See [Become a Solver](/operate/solver) for full guide.

## For Developers

Integrate intents into your app:

```typescript
import { IntentClient } from '@jejunetwork/intents';

const client = new IntentClient({
  chains: [arbitrum, jeju],
  wallet,
});

// Create intent
const intent = await client.createIntent({
  from: { chain: 'arbitrum', token: USDC, amount: '100' },
  to: { chain: 'jeju', token: USDC, minAmount: '99.5' },
});

// Wait for fill
const result = await client.waitForFill(intent.id);
console.log('Received:', result.amountOut);
```

## Economics

| Role | Fee |
|------|-----|
| Protocol | 0.01% |
| Solver | 0.05-0.5% (competitive) |
| Total | ~0.1% typical |

Solvers compete on price, so users get best rates.

## vs Traditional Bridges

| Feature | Intents | Bridges |
|---------|---------|---------|
| Speed | Seconds | 10-30 min |
| UX | 1 signature | Multiple txs |
| Liquidity | Solver inventory | Locked pools |
| Cost | ~0.1% | 0.1-0.5% |
| Trust | Oracle + solver stake | Bridge security |

## Security

- **Solver stake**: Solvers stake ETH, slashed for misbehavior
- **Oracle verification**: Cross-chain state verified before claim
- **Timeout protection**: Intents expire, funds never stuck

## Next Steps

- [Become a Solver](/operate/solver) — Earn from filling intents
- [Become an XLP](/operate/xlp) — Provide liquidity
- [Core Concepts](/learn/concepts) — Deep dive on ERC-7683

