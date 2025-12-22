# EIL Integration

EIL (Ethereum Interop Layer) enables instant bridging to Jeju. Users deposit on Ethereum/Base, receive on Jeju in ~30 seconds.

## How It Works

```
User deposits on Ethereum
        ↓
XLP monitors for deposit event
        ↓
XLP credits user on Jeju (instant)
        ↓
User has funds on Jeju
        ↓
~15 min later: XLP claims deposit from Ethereum
```

XLPs (Cross-chain Liquidity Providers) front the capital, so users don't wait.

## For DApp Developers

### Accept Cross-Chain Deposits

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// User bridges ETH from Ethereum to Jeju
const tx = await jeju.crosschain.transfer({
  from: 'ethereum',
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

console.log('Bridge tx:', tx.hash);

// Wait for credit on Jeju (usually <30 seconds)
const receipt = await jeju.crosschain.waitForTransfer(tx.hash);
console.log('Credited on Jeju:', receipt);
```

### Monitor Deposits

```typescript
// Watch for incoming deposits to your app
jeju.crosschain.onDeposit((deposit) => {
  console.log(`${deposit.from} deposited ${deposit.amount} ${deposit.token}`);
  
  // Credit user in your app
  await creditUserBalance(deposit.from, deposit.amount);
});
```

## For XLPs (Liquidity Providers)

XLPs earn 0.1-0.3% on each transfer by fronting liquidity.

### Requirements

- 1 ETH stake on L1
- Capital on Jeju to front (recommend 5+ ETH worth)
- Server to run the XLP bot

### Step 1: Stake on L1

```bash
# Using cast
cast send 0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2 \
  "register(uint256[])" "[420691]" \
  --value 1ether \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY \
  --private-key $PRIVATE_KEY
```

Or via SDK:

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

await jeju.crosschain.registerXLP({
  stake: parseEther('1'),
  chains: [420691], // Jeju mainnet
});
```

### Step 2: Deposit Liquidity on Jeju

```typescript
// Deposit ETH liquidity that you'll use to credit users
await jeju.crosschain.depositXLPLiquidity({
  token: 'ETH',
  amount: parseEther('5'),
});
```

### Step 3: Run the XLP Bot

```bash
cd packages/bots
cp .env.example .env
# Configure PRIVATE_KEY, L1_RPC_URL, L2_RPC_URL

bun run xlp
```

The bot:
1. Monitors L1 for deposits
2. Credits users on L2
3. Tracks deposits to claim later
4. Claims after L1 finality (~15 min)

### Step 4: Monitor Earnings

```typescript
const stats = await jeju.crosschain.getXLPStats(myAddress);
console.log('Total volume:', stats.volume);
console.log('Total earned:', stats.earnings);
console.log('Current liquidity:', stats.liquidity);
```

## Economics

| Parameter | Value |
|-----------|-------|
| Min XLP Stake | 1 ETH |
| Spread | 0.1-0.3% |
| Protocol Fee | 0.05% |
| XLP Share | 95% of spread |
| Settlement | ~15 minutes |

### Example Earnings

```
Daily volume: $100,000
Spread: 0.2%
Gross: $200/day
Protocol fee: -$50
Net: $150/day = ~$4,500/month

On $50k capital = ~9% monthly return
```

*Returns vary with volume and competition.*

## Contracts (Testnet)

| Contract | Network | Address |
|----------|---------|---------|
| L1StakeManager | Sepolia | `0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2` |
| CrossChainPaymaster | Jeju Testnet | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |

## Contract Functions

### L1StakeManager (on Ethereum)

```solidity
// Register as XLP (requires stake)
function register(uint256[] calldata chains) external payable;

// User deposits for transfer to Jeju
function depositForUser(
    address recipient,
    uint256 destChain,
    address xlp
) external payable;

// XLP claims after L1 finality
function claimDeposit(bytes32 depositHash) external;
```

### CrossChainPaymaster (on Jeju)

```solidity
// XLP deposits liquidity
function depositETH() external payable;
function depositToken(address token, uint256 amount) external;

// XLP credits user (called by XLP bot)
function creditUser(
    address user,
    address token,
    uint256 amount,
    bytes32 l1TxHash
) external;

// XLP withdraws liquidity
function withdraw(address token, uint256 amount) external;
```

## Slashing

XLPs are slashed for:

| Offense | Slash |
|---------|-------|
| Not crediting user within 5 minutes | 10% |
| Double-crediting | 50% |
| Providing wrong amount | 25% |

Users can report via Gateway UI → "Report Missing Credit".

## FAQ

**What if no XLP is available?**

Users can still use the native OP Stack bridge, which takes ~7 days. EIL is an optimization layer.

**What tokens are supported?**

ETH, USDC, USDT, WBTC. More can be added via governance.

**What's the minimum transfer?**

0.01 ETH equivalent. Smaller transfers aren't profitable for XLPs.

---

<details>
<summary>📋 Copy as Context</summary>

```
EIL - Ethereum Interop Layer

Flow:
1. User deposits on L1 (Ethereum/Base)
2. XLP detects deposit
3. XLP credits user on Jeju (instant, ~30s)
4. XLP claims deposit after L1 finality (~15 min)

For DApps:
await jeju.crosschain.transfer({
  from: 'ethereum', to: 'jeju',
  token: 'ETH', amount: parseEther('1')
});
await jeju.crosschain.waitForTransfer(tx.hash);

For XLPs:
1. Stake 1 ETH: await jeju.crosschain.registerXLP({ stake, chains })
2. Deposit liquidity: await jeju.crosschain.depositXLPLiquidity({ token, amount })
3. Run bot: cd packages/bots && bun run xlp

Contracts (testnet):
- L1StakeManager (Sepolia): 0x742d35Cc6634C0532925a3b844Bc9e7595f7a1B2
- CrossChainPaymaster (Jeju): 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9

Economics:
- Stake: 1 ETH
- Spread: 0.1-0.3%
- Protocol: 0.05%
- XLP share: 95%

Slashing: Not crediting 10%, double-credit 50%, wrong amount 25%
```

</details>
