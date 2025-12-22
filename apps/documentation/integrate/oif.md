# OIF Integration

OIF (Open Intents Framework) enables cross-chain swaps. User expresses intent on source chain, solvers compete to fill it on Jeju.

## How It Works

```
User creates intent on Base: "I want 100 USDC → 95 JEJU"
        ↓
Solvers see the intent
        ↓
Solver fills on Jeju (sends 95 JEJU to user)
        ↓
Oracle verifies the fill (~10 min)
        ↓
Solver claims 100 USDC from Base
```

## For DApp Developers

### Create a Cross-Chain Swap

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Swap USDC on Base for JEJU on Jeju
const intentHash = await jeju.crosschain.createIntent({
  sourceChain: 8453, // Base
  inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  inputAmount: parseUnits('100', 6),
  outputChain: 420691, // Jeju
  outputToken: '0x...', // JEJU token address
  minOutputAmount: parseUnits('95', 18), // Accept minimum 95 JEJU
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});

console.log('Intent created:', intentHash);
```

### Check Intent Status

```typescript
const status = await jeju.crosschain.getIntentStatus(intentHash);
// 'pending' | 'filled' | 'expired' | 'settled'

if (status === 'filled') {
  const details = await jeju.crosschain.getIntentDetails(intentHash);
  console.log('Filled by:', details.solver);
  console.log('Output amount:', details.outputAmount);
}
```

### Listen for Fills

```typescript
jeju.crosschain.onIntentFilled(intentHash, (fill) => {
  console.log('Intent filled by', fill.solver);
  console.log('You received', fill.outputAmount);
});
```

## For Solvers

Solvers earn the spread between user's `minOutputAmount` and actual cost.

### Requirements

- 0.5 ETH stake on Jeju
- Capital to fill intents
- Multi-chain RPC access
- Server for solver bot

### Step 1: Register as Solver

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

await jeju.crosschain.registerSolver({
  stake: parseEther('0.5'),
  chains: [420691, 8453], // Jeju and Base
});
```

### Step 2: Monitor Intents

```typescript
// WebSocket feed
const ws = new WebSocket('wss://intents.jejunetwork.org/ws');

ws.onmessage = (event) => {
  const intent = JSON.parse(event.data);
  
  // Check if profitable
  const profit = calculateProfit(intent);
  if (profit > MIN_PROFIT) {
    fillIntent(intent);
  }
};

function calculateProfit(intent: Intent): bigint {
  // User wants to pay inputAmount for at least minOutputAmount
  // If you can acquire minOutputAmount for less than inputAmount, profit!
  const outputCost = getMarketPrice(intent.outputToken, intent.minOutputAmount);
  return intent.inputAmount - outputCost;
}
```

### Step 3: Fill Intents

```typescript
async function fillIntent(intent: Intent) {
  // Check you have liquidity
  const balance = await getBalance(intent.outputToken);
  if (balance < intent.minOutputAmount) {
    console.log('Insufficient liquidity');
    return;
  }

  // Fill on Jeju
  const tx = await jeju.crosschain.fillIntent({
    intentHash: intent.hash,
    outputAmount: intent.minOutputAmount, // Or more to outbid other solvers
  });

  console.log('Filled:', tx.hash);

  // Wait for oracle verification (~10 min)
  await jeju.crosschain.waitForSettlement(intent.hash);

  // Claim from source chain
  await jeju.crosschain.claimSettlement(intent.hash);
  console.log('Settlement claimed');
}
```

### Step 4: Run the Bot

```bash
cd packages/bots
cp .env.example .env
# Configure PRIVATE_KEY, chains, etc.

bun run solver
```

## Contracts (Testnet)

| Contract | Network | Address |
|----------|---------|---------|
| InputSettler | Sepolia | `0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2` |
| InputSettler | Base Sepolia | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| OutputSettler | Jeju Testnet | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| SolverRegistry | Jeju Testnet | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |

## Contract Functions

### InputSettler (on source chains)

```solidity
// Create intent
function createIntent(
    address inputToken,
    uint256 inputAmount,
    uint256 outputChainId,
    address outputToken,
    uint256 minOutputAmount,
    address recipient,
    uint256 deadline
) external returns (bytes32 intentHash);

// Cancel unfilled intent
function cancelIntent(bytes32 intentHash) external;

// Solver claims after oracle verifies
function claimSettlement(bytes32 intentHash) external;
```

### OutputSettler (on Jeju)

```solidity
// Solver fills intent
function fillIntent(
    bytes32 intentHash,
    uint256 outputAmount
) external;
```

### SolverRegistry

```solidity
// Register as solver
function register(uint256[] calldata chains) external payable;

// Add stake
function stake() external payable;

// Withdraw stake (after unbonding)
function withdraw(uint256 amount) external;
```

## Oracle

OIF uses Hyperlane for cross-chain verification:

1. Solver fills on Jeju
2. Hyperlane validators observe fill
3. Validators attest to source chain
4. InputSettler releases funds to solver

Verification takes ~10-15 minutes.

## Economics

| Parameter | Value |
|-----------|-------|
| Min Solver Stake | 0.5 ETH |
| Protocol Fee | 0.1% |
| Oracle Fee | 0.01% |
| Solver Profit | Spread minus fees |

### Example

```
Intent: 100 USDC → minimum 95 JEJU
Market price: 96 JEJU per 100 USDC
Solver acquires 95 JEJU for 98.96 USDC equivalent
Gross profit: 100 - 98.96 = 1.04 USDC (1.04%)
Fees: 0.11 USDC
Net profit: 0.93 USDC per fill
```

## Strategies

### Simple Filling

Fill any intent where spread > fees:

```typescript
if (inputValue > outputCost * 1.002) { // 0.2% min margin
  fillIntent(intent);
}
```

### Market Making

Quote tighter spreads on popular pairs:

```typescript
const PAIRS = {
  'USDC/JEJU': { minSpread: 0.001 }, // 0.1%
  'ETH/WETH': { minSpread: 0.0005 }, // 0.05%
};
```

### JIT Liquidity

Acquire output token just-in-time:

```typescript
// See profitable intent
// Buy output token on Jeju DEX
// Fill intent
// Profit on spread
```

---

<details>
<summary>📋 Copy as Context</summary>

```
OIF - Open Intents Framework

Flow:
1. User creates intent: "100 USDC on Base → 95+ JEJU on Jeju"
2. Solvers monitor for intents
3. Solver fills on Jeju
4. Oracle verifies (~10 min)
5. Solver claims from source chain

For DApps:
const intentHash = await jeju.crosschain.createIntent({
  sourceChain: 8453, inputToken: USDC_BASE, inputAmount: parseUnits('100', 6),
  outputChain: 420691, outputToken: JEJU, minOutputAmount: parseUnits('95', 18),
  deadline: Math.floor(Date.now()/1000) + 3600
});
const status = await jeju.crosschain.getIntentStatus(intentHash);

For Solvers:
1. Register: await jeju.crosschain.registerSolver({ stake: parseEther('0.5'), chains })
2. Monitor: wss://intents.jejunetwork.org/ws
3. Fill: await jeju.crosschain.fillIntent({ intentHash, outputAmount })
4. Claim: await jeju.crosschain.claimSettlement(intentHash)

Contracts (testnet):
- InputSettler: 0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2 (Sepolia)
- OutputSettler: 0x5FbDB2315678afecb367f032d93F642f64180aa3 (Jeju)
- SolverRegistry: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 (Jeju)

Economics:
- Stake: 0.5 ETH
- Protocol: 0.1%
- Oracle: 0.01%
- Profit: spread minus fees

Verification: Hyperlane, ~10-15 min
```

</details>
