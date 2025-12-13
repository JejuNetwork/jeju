# Tutorial: Autonomous Trading Agent

Build an AI agent that monitors markets and executes trades on Bazaar.

**Time:** 45 minutes  
**Level:** Intermediate  
**You'll Learn:**
- Register ERC-8004 agent identity
- Implement A2A protocol endpoints
- Interact with Uniswap V4
- Manage agent vault

## What We're Building

An autonomous agent that:
1. Monitors token prices via Indexer
2. Executes trades when conditions are met
3. Responds to A2A task requests
4. Manages its own funds via vault

## Prerequisites

- [Jeju running locally](/build/quick-start)
- Basic understanding of [Agent Identity](/learn/agents)

## Step 1: Create Project

```bash
mkdir trading-agent && cd trading-agent
bun init -y
bun add viem hono @hono/node-server
```

## Step 2: Register Agent Identity

First, we register the agent on-chain:

```typescript
// src/register.ts
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { IdentityRegistryAbi } from '@jejunetwork/contracts';
import { getContract } from '@jejunetwork/config';

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);

const client = createWalletClient({
  account,
  chain: jejuLocalnet,
  transport: http('http://127.0.0.1:9545'),
});

async function registerAgent() {
  const registryAddress = getContract('registry', 'identity');

  const hash = await client.writeContract({
    address: registryAddress,
    abi: IdentityRegistryAbi,
    functionName: 'register',
    args: [
      'TradingBot',
      'Autonomous market maker that provides liquidity',
      'http://localhost:3000/a2a',  // A2A endpoint
      'http://localhost:3000/mcp',   // MCP endpoint
      '',  // No IPFS metadata for now
    ],
  });

  console.log('Agent registered:', hash);
}

registerAgent();
```

## Step 3: Implement A2A Server

```typescript
// src/server.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { executeTrade, getMarketData } from './trading';

const app = new Hono();

// Agent Card (discovery)
app.get('/.well-known/agent-card.json', (c) => {
  return c.json({
    protocolVersion: '0.3.0',
    name: 'TradingBot',
    description: 'Autonomous market maker',
    url: 'http://localhost:3000',
    skills: [
      {
        id: 'get-price',
        name: 'Get Token Price',
        description: 'Get current price for a token pair',
        parameters: {
          tokenIn: 'Token address to price',
          tokenOut: 'Quote token address',
        },
      },
      {
        id: 'execute-trade',
        name: 'Execute Trade',
        description: 'Swap tokens at current market price',
        parameters: {
          tokenIn: 'Token to sell',
          tokenOut: 'Token to buy',
          amountIn: 'Amount to sell (in wei)',
          maxSlippage: 'Max slippage (basis points)',
        },
      },
    ],
  });
});

// A2A Task Handler
app.post('/a2a', async (c) => {
  const body = await c.req.json();
  
  if (body.type === 'task') {
    const { skill, parameters } = body.task;
    
    switch (skill) {
      case 'get-price':
        const price = await getMarketData(
          parameters.tokenIn,
          parameters.tokenOut
        );
        return c.json({
          type: 'task-result',
          status: 'completed',
          result: { price },
        });
        
      case 'execute-trade':
        const result = await executeTrade(
          parameters.tokenIn,
          parameters.tokenOut,
          BigInt(parameters.amountIn),
          parameters.maxSlippage
        );
        return c.json({
          type: 'task-result',
          status: 'completed',
          result,
        });
        
      default:
        return c.json({
          type: 'task-result',
          status: 'failed',
          error: `Unknown skill: ${skill}`,
        });
    }
  }
  
  return c.json({ error: 'Invalid request type' }, 400);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

serve({ fetch: app.fetch, port: 3000 });
console.log('Agent running at http://localhost:3000');
```

## Step 4: Trading Logic

```typescript
// src/trading.ts
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: jejuLocalnet,
  transport: http('http://127.0.0.1:9545'),
});

const walletClient = createWalletClient({
  account,
  chain: jejuLocalnet,
  transport: http('http://127.0.0.1:9545'),
});

// Get current market price
export async function getMarketData(tokenIn: string, tokenOut: string) {
  // Query Indexer for pool data
  const response = await fetch('http://127.0.0.1:4350/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetPool($token0: String!, $token1: String!) {
          pools(where: { token0_eq: $token0, token1_eq: $token1 }) {
            sqrtPriceX96
            liquidity
            tick
          }
        }
      `,
      variables: { token0: tokenIn, token1: tokenOut },
    }),
  });
  
  const { data } = await response.json();
  
  if (!data.pools.length) {
    throw new Error('Pool not found');
  }
  
  const pool = data.pools[0];
  // Convert sqrtPriceX96 to human readable
  const price = (Number(pool.sqrtPriceX96) / 2**96) ** 2;
  
  return {
    price,
    liquidity: pool.liquidity,
  };
}

// Execute a swap
export async function executeTrade(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  maxSlippageBps: number = 50 // 0.5%
) {
  const SWAP_ROUTER = '0x...'; // Uniswap V4 SwapRouter

  // Get quote
  const { price } = await getMarketData(tokenIn, tokenOut);
  const expectedOut = Number(amountIn) * price;
  const minOut = BigInt(Math.floor(expectedOut * (1 - maxSlippageBps / 10000)));

  // Approve router
  await walletClient.writeContract({
    address: tokenIn as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'approve',
    args: [SWAP_ROUTER, amountIn],
  });

  // Execute swap
  const hash = await walletClient.writeContract({
    address: SWAP_ROUTER as `0x${string}`,
    abi: SwapRouterAbi,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn,
      tokenOut,
      fee: 3000, // 0.3%
      recipient: account.address,
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    }],
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  return {
    success: receipt.status === 'success',
    txHash: hash,
    amountIn: formatUnits(amountIn, 18),
    minAmountOut: formatUnits(minOut, 18),
  };
}
```

## Step 5: Autonomous Loop

```typescript
// src/strategy.ts
import { getMarketData, executeTrade } from './trading';

const USDC = '0x...';
const JEJU = '0x...';
const CHECK_INTERVAL = 60_000; // 1 minute

// Simple momentum strategy
let lastPrice = 0;

async function runStrategy() {
  console.log('Checking market...');
  
  try {
    const { price } = await getMarketData(JEJU, USDC);
    console.log(`JEJU/USDC: ${price}`);
    
    if (lastPrice === 0) {
      lastPrice = price;
      return;
    }
    
    const change = (price - lastPrice) / lastPrice;
    
    // If price up >2%, sell JEJU for USDC
    if (change > 0.02) {
      console.log('Price up 2%, selling JEJU...');
      const result = await executeTrade(
        JEJU,
        USDC,
        parseUnits('100', 18), // Sell 100 JEJU
        100 // 1% slippage
      );
      console.log('Trade result:', result);
    }
    
    // If price down >2%, buy JEJU with USDC
    if (change < -0.02) {
      console.log('Price down 2%, buying JEJU...');
      const result = await executeTrade(
        USDC,
        JEJU,
        parseUnits('100', 6), // Buy with 100 USDC
        100
      );
      console.log('Trade result:', result);
    }
    
    lastPrice = price;
  } catch (error) {
    console.error('Strategy error:', error);
  }
}

// Run continuously
setInterval(runStrategy, CHECK_INTERVAL);
runStrategy();
```

## Step 6: Vault Management

Agents should use vaults for better fund management:

```typescript
// src/vault.ts
import { AgentVaultAbi } from '@jejunetwork/contracts';

const VAULT_ADDRESS = '0x...';

// Check vault balance
export async function getVaultBalance(token: string) {
  const balance = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: AgentVaultAbi,
    functionName: 'getBalance',
    args: [token],
  });
  return balance;
}

// Request funds from vault
export async function requestFunds(token: string, amount: bigint) {
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi: AgentVaultAbi,
    functionName: 'withdraw',
    args: [token, amount],
  });
  return hash;
}

// Return funds to vault
export async function returnFunds(token: string, amount: bigint) {
  // First approve
  await walletClient.writeContract({
    address: token as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'approve',
    args: [VAULT_ADDRESS, amount],
  });
  
  // Then deposit
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS,
    abi: AgentVaultAbi,
    functionName: 'deposit',
    args: [token, amount],
  });
  return hash;
}
```

## Step 7: Run the Agent

```bash
# Set environment
export AGENT_PRIVATE_KEY=0x...

# Register on-chain
bun run src/register.ts

# Start agent server + strategy
bun run src/server.ts &
bun run src/strategy.ts
```

## Step 8: Test via A2A

Other agents (or you) can interact:

```bash
# Get price
curl http://localhost:3000/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "get-price",
      "parameters": {
        "tokenIn": "0x...",
        "tokenOut": "0x..."
      }
    }
  }'

# Execute trade
curl http://localhost:3000/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "execute-trade",
      "parameters": {
        "tokenIn": "0x...",
        "tokenOut": "0x...",
        "amountIn": "1000000000000000000",
        "maxSlippage": 50
      }
    }
  }'
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Trading Agent                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  A2A Server │  │  Strategy   │  │    Vault    │      │
│  │   :3000     │  │   Loop      │  │  Management │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │              │
│         └────────────────┼────────────────┘              │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌──────────┐  ┌─────────┐
        │ Indexer │  │ Uniswap  │  │  Vault  │
        │ GraphQL │  │    V4    │  │Contract │
        └─────────┘  └──────────┘  └─────────┘
```

## Improvements

- Add stop-loss protection
- Implement multiple strategies
- Use Crucible for scheduling
- Add position tracking
- Integrate with storage for state persistence

## Full Code

See complete example: [github.com/elizaos/jeju-examples/trading-agent](https://github.com/elizaos/jeju-examples/trading-agent)

