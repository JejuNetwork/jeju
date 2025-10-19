# @elizaos/plugin-x402

Eliza plugin enabling autonomous x402 micropayments for AI agents.

## Overview

This plugin allows Eliza agents to:
- ✅ Automatically handle HTTP 402 Payment Required responses
- ✅ Sign and submit USDC payments via x402 protocol
- ✅ Pay for MCP tools, Cloud services, game entry fees, etc.
- ✅ Track spending with daily/per-transaction limits
- ✅ Work with any x402-enabled service

## Installation

```bash
bun add @elizaos/plugin-x402
```

## Usage

### Basic Setup

```typescript
import { x402Plugin } from '@elizaos/plugin-x402';

const runtime = new AgentRuntime({
  plugins: [x402Plugin],
  settings: {
    // Required: Private key for payments (keep secure!)
    AGENT_PAYMENT_KEY: '0x...',
    
    // Optional: Network (default: 'jeju')
    X402_NETWORK: 'jeju',
    
    // Optional: Custom facilitator
    X402_FACILITATOR_URL: 'https://facilitator.jeju.network',
    
    // Optional: Spending limits (USDC atomic units, 6 decimals)
    X402_DAILY_LIMIT: '10000000', // $10/day
    X402_PER_TX_LIMIT: '1000000', // $1 per transaction
    X402_ALLOWED_SERVICES: 'api.example.com,cloud.jeju.network'
  }
});
```

### Paying for Services

```typescript
// Agents can automatically pay for services
const walletService = runtime.getService('x402-wallet');

const response = await walletService.makePaymentRequest(
  'https://api.example.com/generate-image',
  {
    method: 'POST',
    body: JSON.stringify({ prompt: 'a beautiful sunset' }),
    maxPaymentAmount: '100000' // $0.10
  }
);

const result = await response.json();
```

### Using Actions

Agents can trigger payments through natural language:

```
User: "Generate an image using the paid API"
Agent: [Automatically uses PAY_FOR_SERVICE_X402 action]
      "I'll pay for the image generation service..."
      [Signs x402 payment with USDC]
      [Returns generated image]
```

```
User: "How much have I spent on payments today?"
Agent: [Uses CHECK_X402_BALANCE action]
      "You've spent $2.50 today out of your $10 daily limit.
       Total: $15.80 across 3 services
       Most used: cloud.jeju.network"
```

## Services

### X402WalletService

Manages the agent's payment wallet:
- Initializes from private key
- Creates x402-enabled fetch
- Enforces spending limits
- Tracks payment history

### X402PaymentService

Tracks payment analytics:
- Per-service spending
- Total spending
- Payment counts
- Service usage patterns

## Actions

### PAY_FOR_SERVICE_X402

Make a payment to an x402-enabled service.

**Triggers**: "pay for", "purchase", "buy service", "use paid service"

**Options**:
- `url` (required): Service URL
- `method`: HTTP method (default: POST)
- `body`: Request body
- `maxAmount`: Maximum payment in USDC atomic units

### CHECK_X402_BALANCE

Check payment status and spending.

**Triggers**: "check balance", "payment history", "spending", "x402 status"

## Security

### Spending Limits

Default limits (configurable):
- **Per Transaction**: $1.00
- **Daily**: $10.00
- **Per Service**: $5.00

Limits prevent wallet drain if agent is compromised.

### Private Key Management

**IMPORTANT**: Store `AGENT_PAYMENT_KEY` securely!

Recommendations:
1. Use separate keys for payments vs. identity
2. Fund payment wallet with limited amounts
3. Enable spending limits
4. Monitor for unusual activity
5. Rotate keys periodically

### Best Practices

```typescript
// ✅ GOOD: Separate payment key with low balance
AGENT_IDENTITY_KEY=0x... // Main wallet (NFTs, identity)
AGENT_PAYMENT_KEY=0x...  // Payment wallet ($50 max)

// ❌ BAD: Same key for everything
AGENT_KEY=0x... // High value + payments = risky
```

## Integration Examples

### MCP Gateway

```typescript
// Agent using x402 to call paid MCP tools
const response = await walletService.makePaymentRequest(
  'http://localhost:8000/message',
  {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'crypto:get_price', arguments: { symbol: 'ETH' } }
    }),
    maxPaymentAmount: '10000' // $0.01
  }
);
```

### Cloud Generation

```typescript
// Agent paying for image generation
const response = await walletService.makePaymentRequest(
  'https://cloud.jeju.network/api/v1/generate-image',
  {
    method: 'POST',
    body: JSON.stringify({ prompt: 'a sunset', model: 'gemini' }),
    maxPaymentAmount: '100000' // $0.10
  }
);
```

### Caliguland Game

```typescript
// Agent paying game entry fee
const response = await walletService.makePaymentRequest(
  'https://caliguland.jeju.network/a2a/join-game',
  {
    method: 'POST',
    body: JSON.stringify({ agentId: agent.id }),
    maxPaymentAmount: '100000' // $0.10 entry
  }
);
```

## Payment Flow

```
1. Agent makes request to x402-enabled service
   ↓
2. Service returns HTTP 402 Payment Required
   ↓
3. x402-fetch intercepts and creates payment
   ↓
4. Agent signs USDC transfer (EIP-3009)
   ↓
5. Payment verified by facilitator
   ↓
6. Agent retries request with X-PAYMENT header
   ↓
7. Service verifies payment and returns result
   ↓
8. Payment settled on Jeju chain
```

## Configuration Reference

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `AGENT_PAYMENT_KEY` | ✅ Yes | - | Private key for signing payments |
| `X402_NETWORK` | No | `'jeju'` | Blockchain network for payments |
| `X402_FACILITATOR_URL` | No | Auto-detected | Custom facilitator URL |
| `X402_DAILY_LIMIT` | No | `10000000` ($10) | Daily spending limit (atomic units) |
| `X402_PER_TX_LIMIT` | No | `1000000` ($1) | Per-transaction limit |
| `X402_ALLOWED_SERVICES` | No | All | Comma-separated allowed domains |

## Supported Networks

- `jeju` - Jeju Mainnet (420691)
- `jeju-testnet` - Jeju Testnet (420690)
- `jeju-localnet` - Local development (1337)
- `base` - Base Mainnet
- `base-sepolia` - Base Testnet
- `ethereum` - Ethereum Mainnet
- `optimism` - Optimism
- `polygon` - Polygon

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Type check
bun run type-check

# Test
bun test
```

## Testing

```typescript
import { describe, it, expect, beforeAll } from 'bun:test';
import { x402Plugin } from '@elizaos/plugin-x402';

describe('x402 Plugin', () => {
  it('should initialize wallet service', async () => {
    const runtime = createTestRuntime({
      AGENT_PAYMENT_KEY: '0x...'
    });
    
    await runtime.initialize();
    
    const wallet = runtime.getService('x402-wallet');
    expect(wallet).toBeDefined();
  });
});
```

## Troubleshooting

### "AGENT_PAYMENT_KEY required"
Set the private key in agent settings:
```typescript
settings: {
  AGENT_PAYMENT_KEY: '0x...'
}
```

### "Daily spending limit reached"
Increase limit or wait until next day:
```typescript
settings: {
  X402_DAILY_LIMIT: '20000000' // $20/day
}
```

### "Payment failed: insufficient balance"
Fund the payment wallet with USDC:
```bash
# Use faucet (testnet)
cast send $USDC_ADDRESS "faucet()" --rpc-url $JEJU_TESTNET_RPC --private-key $AGENT_PAYMENT_KEY

# Or transfer from main wallet
cast send $USDC_ADDRESS "transfer(address,uint256)" $AGENT_PAYMENT_ADDRESS 100000000 --rpc-url $JEJU_RPC
```

## License

MIT

## Links

- [x402 Protocol](https://x402.org)
- [Jeju Network](https://jeju.network)
- [ElizaOS](https://elizaos.ai)

