# SDK

TypeScript SDK for Jeju. Everything you need: DeFi, bridging, storage, compute, identity.

## Install

```bash
bun add @jejunetwork/sdk viem
```

## Quick Start

```typescript
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';

const jeju = await createJejuClient({
  network: 'testnet', // 'mainnet' | 'testnet' | 'localnet'
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Check balance
const balance = await jeju.getBalance();
console.log('Balance:', balance);

// Swap tokens
await jeju.defi.swap({
  tokenIn: 'USDC',
  tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
});

// Bridge from Base
await jeju.crosschain.transfer({
  from: 'base',
  to: 'jeju',
  token: 'USDC',
  amount: parseUnits('50', 6),
});
```

## Configuration

```typescript
const jeju = await createJejuClient({
  // Required: which network
  network: 'testnet',
  
  // One of these required:
  privateKey: '0x...',      // Private key
  mnemonic: 'word word...', // Or mnemonic
  
  // Optional:
  smartAccount: true,  // Use ERC-4337 account (default: true)
  rpcUrl: '...',       // Override RPC
  bundlerUrl: '...',   // Override bundler
});
```

## Core Modules

These are the most-used modules. Start here.

### defi — Swaps & Liquidity

```typescript
// Swap tokens
await jeju.defi.swap({
  tokenIn: 'USDC',
  tokenOut: 'JEJU',
  amountIn: parseUnits('100', 6),
  slippage: 0.5, // 0.5% max slippage
});

// Add liquidity
await jeju.defi.addLiquidity({
  tokenA: 'JEJU',
  tokenB: 'USDC',
  amountA: parseEther('1000'),
  amountB: parseUnits('500', 6),
});

// Remove liquidity
await jeju.defi.removeLiquidity({
  pair: 'JEJU/USDC',
  percent: 50, // Remove 50%
});
```

### crosschain — Bridging & Intents

```typescript
// Instant bridge (EIL)
await jeju.crosschain.transfer({
  from: 'ethereum', // 'ethereum' | 'base'
  to: 'jeju',
  token: 'ETH',
  amount: parseEther('1'),
});

// Cross-chain swap (OIF)
const intentHash = await jeju.crosschain.createIntent({
  sourceChain: 8453, // Base
  inputToken: '0x...', // USDC on Base
  inputAmount: parseUnits('100', 6),
  outputChain: 420691, // Jeju
  outputToken: '0x...', // JEJU
  minOutputAmount: parseUnits('95', 18),
  deadline: Math.floor(Date.now() / 1000) + 3600,
});

// Check intent status
const status = await jeju.crosschain.getIntentStatus(intentHash);
// 'pending' | 'filled' | 'expired' | 'settled'
```

### payments — Gasless Transactions

```typescript
// User pays gas in USDC
await jeju.payments.payWithToken({
  to: contractAddress,
  data: calldata,
  gasToken: 'USDC',
});

// Your app sponsors gas (free for user)
await jeju.payments.sponsoredCall({
  paymaster: yourPaymasterAddress,
  to: contractAddress,
  data: calldata,
});

// Deploy your own paymaster
const paymaster = await jeju.payments.deployPaymaster({
  name: 'My App Paymaster',
});

// Fund it
await jeju.payments.fundPaymaster({
  paymaster: paymaster.address,
  amount: parseEther('1'),
});
```

### storage — IPFS

```typescript
// Upload
const cid = await jeju.storage.upload(file);
console.log('CID:', cid);

// Pin for 30 days
await jeju.storage.pin(cid, { 
  duration: 30 * 24 * 60 * 60 
});

// Download
const data = await jeju.storage.get(cid);
```

### compute — AI Inference

```typescript
// List available models
const models = await jeju.compute.listModels();

// Run inference
const result = await jeju.compute.inference({
  model: 'llama3.2',
  prompt: 'Explain DeFi in one sentence',
  maxTokens: 100,
});

console.log(result.text);
```

### identity — Agent Registry

```typescript
// Register as an agent
await jeju.identity.registerAgent({
  name: 'My Trading Bot',
  description: 'Automated DeFi trading',
  endpoints: {
    a2a: 'https://mybot.com/a2a',
  },
  labels: ['trading', 'defi'],
});

// Look up an agent
const agent = await jeju.identity.getAgent('0x...');
console.log(agent.name, agent.endpoints);

// Search agents
const bots = await jeju.identity.searchAgents({
  labels: ['trading'],
  limit: 10,
});
```

### names — JNS Domains

```typescript
// Register alice.jeju
await jeju.names.register({
  name: 'alice',
  duration: 365 * 24 * 60 * 60, // 1 year
});

// Resolve name → address
const address = await jeju.names.resolve('alice.jeju');

// Reverse lookup address → name
const name = await jeju.names.reverse('0x...');
```

## Extended Modules

Less common, but available:

| Module | What it does |
|--------|--------------|
| `agents` | Agent vaults, multi-agent rooms |
| `staking` | JEJU staking, node staking |
| `governance` | Proposals, voting |
| `launchpad` | Token launches, presales |
| `moderation` | Reputation, reporting |
| `work` | Bounties, projects |
| `otc` | Peer-to-peer trades |
| `messaging` | Encrypted messaging |
| `perps` | Perpetual futures |
| `oracle` | Price feeds |
| `vpn` | Decentralized VPN |
| `models` | Model registry |
| `mcp` | Model Context Protocol |

## Wallet Access

```typescript
// Get underlying wallet
const { wallet } = jeju;

// Address
console.log(wallet.address);

// Is smart account?
console.log(wallet.isSmartAccount);

// Direct transaction
const hash = await jeju.sendTransaction({
  to: '0x...',
  value: parseEther('1'),
  data: '0x',
});
```

## Error Handling

```typescript
import { JejuError } from '@jejunetwork/sdk';

try {
  await jeju.defi.swap({ ... });
} catch (error) {
  if (error instanceof JejuError) {
    console.error(`Error ${error.code}: ${error.message}`);
    // Common codes: INSUFFICIENT_BALANCE, SLIPPAGE_EXCEEDED, TX_FAILED
  }
  throw error;
}
```

## TypeScript

The SDK is fully typed. Import types:

```typescript
import type { 
  JejuClient, 
  JejuClientConfig,
  SwapParams,
  TransferParams,
} from '@jejunetwork/sdk';
```

## Using with viem Directly

You can access the underlying viem clients:

```typescript
const { wallet } = jeju;

// Public client (read-only)
const block = await wallet.publicClient.getBlockNumber();

// Wallet client (write)
await wallet.walletClient.sendTransaction({ ... });
```

---

<details>
<summary>📋 Copy as Context</summary>

```
@jejunetwork/sdk

Install: bun add @jejunetwork/sdk viem

Setup:
import { createJejuClient } from '@jejunetwork/sdk';
import { parseUnits, parseEther } from 'viem';
const jeju = await createJejuClient({ network: 'testnet', privateKey: '0x...' });

Core modules:
- jeju.defi.swap({ tokenIn, tokenOut, amountIn })
- jeju.crosschain.transfer({ from, to, token, amount })
- jeju.payments.payWithToken({ to, data, gasToken })
- jeju.payments.sponsoredCall({ paymaster, to, data })
- jeju.storage.upload(file) → cid
- jeju.compute.inference({ model, prompt })
- jeju.identity.registerAgent({ name, endpoints })
- jeju.names.register({ name, duration })

Extended: agents, staking, governance, launchpad, moderation, work, otc, messaging, perps, oracle, vpn, models, mcp

Config:
- network: 'mainnet' | 'testnet' | 'localnet'
- privateKey or mnemonic
- smartAccount: true (default, uses ERC-4337)

Direct wallet: jeju.wallet.address, jeju.wallet.publicClient, jeju.sendTransaction()
```

</details>
