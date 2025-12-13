# Become a Solver

Fill cross-chain intents and earn from spreads.

## What is a Solver?

Solvers fill user intents across chains:
1. Monitor for open intents
2. Evaluate profitability
3. Fill on destination chain
4. Claim payment on source chain

## Requirements

| Requirement | Value |
|-------------|-------|
| Stake | 0.5 ETH on Jeju |
| Capital | Working capital for fills |
| Infrastructure | Always-on server |

## Economics

Solvers earn the spread between user's `amountIn` and `minAmountOut`:

```
User wants: 100 USDC on Jeju
User pays:  100.05 USDC on Arbitrum
Solver earns: 0.05 USDC (0.05%)
```

Typical spreads: 0.05% - 0.5%

## Step 1: Register

```bash
cast send $SOLVER_REGISTRY "register()" \
  --value 0.5ether \
  --rpc-url https://rpc.jeju.network \
  --private-key $PK
```

## Step 2: Run Solver

```bash
cd jeju/packages/solver
bun install
PRIVATE_KEY=$PK bun run start
```

Or build your own:

```typescript
import { SolverClient } from '@jejunetwork/solver';

const solver = new SolverClient({
  chains: ['arbitrum', 'base', 'optimism', 'jeju'],
  privateKey: process.env.PRIVATE_KEY,
  minProfitBps: 5, // 0.05% minimum
});

solver.on('intent', async (intent) => {
  const profit = solver.evaluateProfit(intent);
  
  if (profit > solver.minProfitBps) {
    await solver.fill(intent);
  }
});

solver.start();
```

## Step 3: Monitor

```bash
# Check registration
cast call $SOLVER_REGISTRY "getSolver(address)" $YOUR_ADDRESS

# Check fills
cast call $OUTPUT_SETTLER "getFills(address)" $YOUR_ADDRESS

# Check pending claims
cast call $INPUT_SETTLER "getPendingClaims(address)" $YOUR_ADDRESS
```

## Fill Flow

```
1. Intent created on source chain (InputSettler)
2. Solver sees via Indexer/WebSocket
3. Solver fills on Jeju (OutputSettler)
4. Oracle verifies source chain deposit
5. Solver claims from InputSettler
```

## Profitability

| Factor | Impact |
|--------|--------|
| Speed | Faster = more fills |
| Capital | More = bigger fills |
| Gas efficiency | Lower = higher profit |
| Multi-chain | More opportunities |

## Risks

| Risk | Mitigation |
|------|------------|
| Failed fill | Check liquidity before |
| Oracle delay | Wait for confirmation |
| Reorg | Add safety margin |
| Competition | Optimize speed |

## Slashing

| Offense | Penalty |
|---------|---------|
| Invalid fill | 100% stake |
| Front-running | 50% stake |
| Repeated failures | Warning → removal |

## Claiming

```bash
# After oracle confirms
cast send $INPUT_SETTLER "claimPayment(bytes32)" $INTENT_ID \
  --rpc-url $SOURCE_RPC --private-key $PK
```

## Unstaking

```bash
# Initiate
cast send $SOLVER_REGISTRY "initiateUnstake()" \
  --rpc-url https://rpc.jeju.network --private-key $PK

# After 7 days
cast send $SOLVER_REGISTRY "completeUnstake()" \
  --rpc-url https://rpc.jeju.network --private-key $PK
```

