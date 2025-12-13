# Tutorial: Pay-per-Query API with x402

Build an API that charges users per request using the x402 payment protocol.

**Time:** 30 minutes  
**Level:** Intermediate  
**You'll Learn:**
- x402 payment protocol
- Server-side payment verification
- Client-side payment signing
- Facilitator integration

## What We're Building

A premium API where:
1. Client makes request
2. Server returns 402 Payment Required
3. Client signs payment
4. Client retries with payment header
5. Server verifies and serves content
6. Payment settles on-chain

## Prerequisites

- [Jeju running locally](/build/quick-start)
- Understanding of [x402 protocol](/reference/api/x402)

## Step 1: Create Project

```bash
mkdir x402-api && cd x402-api
bun init -y
bun add hono @hono/node-server viem
```

## Step 2: Payment Middleware

```typescript
// src/middleware/x402.ts
import { verifyPayment, createPaymentRequirement } from '@jejunetwork/x402';

interface X402Options {
  recipient: `0x${string}`;
  amount: bigint;
  description: string;
  facilitatorUrl: string;
}

export function x402Middleware(options: X402Options) {
  return async (c: Context, next: Next) => {
    const paymentHeader = c.req.header('X-Payment');
    
    // No payment - return 402
    if (!paymentHeader) {
      const requirement = createPaymentRequirement({
        resource: c.req.path,
        amount: options.amount,
        description: options.description,
        recipient: options.recipient,
        network: 'jeju',
      });
      
      c.status(402);
      return c.json(requirement);
    }
    
    // Verify payment with facilitator
    try {
      const verification = await fetch(`${options.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment: paymentHeader,
          resource: c.req.path,
          amount: options.amount.toString(),
          recipient: options.recipient,
        }),
      });
      
      if (!verification.ok) {
        c.status(402);
        return c.json({
          error: 'Payment verification failed',
          details: await verification.text(),
        });
      }
      
      // Payment valid - continue to handler
      await next();
      
      // After response, settle payment
      await fetch(`${options.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment: paymentHeader }),
      });
    } catch (error) {
      c.status(500);
      return c.json({ error: 'Payment processing error' });
    }
  };
}
```

## Step 3: Build the API

```typescript
// src/server.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { parseEther } from 'viem';
import { x402Middleware } from './middleware/x402';

const app = new Hono();

app.use('*', cors());

// Free endpoint
app.get('/api/free', (c) => {
  return c.json({
    message: 'This endpoint is free!',
    timestamp: new Date().toISOString(),
  });
});

// Premium endpoint - requires payment
app.get(
  '/api/premium/data',
  x402Middleware({
    recipient: process.env.PAYMENT_ADDRESS as `0x${string}`,
    amount: parseEther('0.001'), // 0.001 ETH per request
    description: 'Access to premium data',
    facilitatorUrl: 'http://127.0.0.1:3402',
  }),
  async (c) => {
    // This only runs if payment is valid
    return c.json({
      premium: true,
      data: {
        secretValue: 42,
        timestamp: new Date().toISOString(),
        message: 'Thanks for paying!',
      },
    });
  }
);

// AI inference endpoint - higher cost
app.post(
  '/api/premium/inference',
  x402Middleware({
    recipient: process.env.PAYMENT_ADDRESS as `0x${string}`,
    amount: parseEther('0.01'), // 0.01 ETH per inference
    description: 'AI inference request',
    facilitatorUrl: 'http://127.0.0.1:3402',
  }),
  async (c) => {
    const { prompt } = await c.req.json();
    
    // Your AI inference logic here
    const response = await runInference(prompt);
    
    return c.json({ response });
  }
);

serve({ fetch: app.fetch, port: 3000 });
console.log('API running at http://localhost:3000');
```

## Step 4: Create Payment Client

```typescript
// src/client.ts
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: jejuLocalnet,
  transport: http('http://127.0.0.1:9545'),
});

interface PaymentRequirement {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    payTo: string;
    maxTimeoutSeconds: number;
  }>;
}

export class X402Client {
  private wallet: typeof walletClient;
  
  constructor(wallet: typeof walletClient) {
    this.wallet = wallet;
  }
  
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    // First request - might get 402
    let response = await fetch(url, init);
    
    if (response.status !== 402) {
      return response;
    }
    
    // Got 402 - need to pay
    const requirement: PaymentRequirement = await response.json();
    const payment = requirement.accepts[0];
    
    // Create payment signature
    const paymentData = {
      version: 1,
      network: payment.network,
      amount: payment.maxAmountRequired,
      recipient: payment.payTo,
      resource: payment.resource,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: Math.random().toString(36).slice(2),
    };
    
    const signature = await this.wallet.signTypedData({
      domain: {
        name: 'x402',
        version: '1',
        chainId: 1337,
      },
      types: {
        Payment: [
          { name: 'version', type: 'uint8' },
          { name: 'network', type: 'string' },
          { name: 'amount', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'resource', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'nonce', type: 'string' },
        ],
      },
      primaryType: 'Payment',
      message: paymentData,
    });
    
    const paymentHeader = JSON.stringify({
      ...paymentData,
      signature,
      payer: this.wallet.account.address,
    });
    
    // Retry with payment
    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        'X-Payment': paymentHeader,
      },
    });
  }
}
```

## Step 5: Using the Client

```typescript
// src/example.ts
import { X402Client } from './client';

const client = new X402Client(walletClient);

// Free endpoint - works normally
const freeResponse = await fetch('http://localhost:3000/api/free');
console.log('Free:', await freeResponse.json());

// Premium endpoint - automatically handles payment
const premiumResponse = await client.fetch('http://localhost:3000/api/premium/data');
console.log('Premium:', await premiumResponse.json());

// AI inference - higher cost, same flow
const inferenceResponse = await client.fetch('http://localhost:3000/api/premium/inference', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'What is the meaning of life?' }),
});
console.log('Inference:', await inferenceResponse.json());
```

## Step 6: Run with Facilitator

The Facilitator verifies and settles payments:

```bash
# Terminal 1: Start local chain
cd jeju && bun run dev

# Terminal 2: Start facilitator (part of Jeju)
cd jeju/apps/facilitator && bun run dev

# Terminal 3: Start your API
cd x402-api
export PAYMENT_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
bun run src/server.ts

# Terminal 4: Test with client
export CLIENT_PRIVATE_KEY=0xac0974bec...
bun run src/example.ts
```

## How It Works

```
Client                    Server                   Facilitator
   │                         │                          │
   │──── GET /api/premium ──►│                          │
   │                         │                          │
   │◄─── 402 + Requirements ─│                          │
   │                         │                          │
   │ (sign payment)          │                          │
   │                         │                          │
   │── GET + X-Payment ─────►│                          │
   │                         │─── POST /verify ────────►│
   │                         │◄── { valid: true } ──────│
   │                         │                          │
   │◄──── 200 + Data ────────│                          │
   │                         │                          │
   │                         │─── POST /settle ────────►│
   │                         │    (async, on-chain)     │
   │                         │                          │
```

## Pricing Tiers

You can implement different pricing:

```typescript
// Per-request pricing
const PRICING = {
  '/api/basic': parseEther('0.0001'),
  '/api/premium': parseEther('0.001'),
  '/api/inference': parseEther('0.01'),
  '/api/enterprise': parseEther('0.1'),
};

function getPriceForPath(path: string): bigint {
  return PRICING[path] ?? parseEther('0.001');
}
```

## Monthly Subscriptions

For subscription-based access:

```typescript
// Check if user has active subscription
async function hasSubscription(address: string): Promise<boolean> {
  const expiry = await subscriptionContract.read.getExpiry([address]);
  return expiry > Date.now() / 1000;
}

// Middleware that checks subscription OR payment
app.get('/api/premium/*', async (c, next) => {
  const address = getAddressFromHeader(c);
  
  if (address && await hasSubscription(address)) {
    return next(); // Subscriber - no payment needed
  }
  
  // Not subscribed - use x402
  return x402Middleware(options)(c, next);
});
```

## Error Handling

```typescript
// Server response codes
// 402 - Payment required (with payment instructions)
// 400 - Invalid payment format
// 403 - Payment signature invalid
// 408 - Payment expired
// 409 - Payment already used (replay attack)
// 500 - Settlement failed

// Client handling
try {
  const response = await client.fetch(url);
  if (!response.ok) {
    const error = await response.json();
    console.error('Request failed:', error);
  }
} catch (e) {
  console.error('Network error:', e);
}
```

## Production Considerations

1. **Payment caching** - Don't verify the same payment twice
2. **Replay protection** - Use nonces and timestamps
3. **Rate limiting** - Even with payments, prevent abuse
4. **Settlement batching** - Batch small payments to save gas
5. **Refund logic** - Handle failed requests after payment

## Full Code

See complete example: [github.com/elizaos/jeju-examples/x402-api](https://github.com/elizaos/jeju-examples/x402-api)

