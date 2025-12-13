# Jeju x402 Facilitator

HTTP-based payment verification and settlement service implementing the [x402 protocol](https://x402.org).

## Overview

The facilitator provides a REST API for:
- **Verifying** x402 payment signatures (EIP-712)
- **Settling** verified payments on-chain
- **Discovering** supported networks and tokens

## Quick Start

```bash
# Install dependencies
bun install

# Start the server (development)
bun run dev

# Run tests
bun test

# Type check
bun run typecheck
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `FACILITATOR_PORT` | 3402 | HTTP server port |
| `X402_FACILITATOR_ADDRESS` | - | On-chain facilitator contract |
| `JEJU_RPC_URL` | http://127.0.0.1:9545 | RPC endpoint |
| `FACILITATOR_PRIVATE_KEY` | - | Hot wallet for gas sponsorship |
| `PROTOCOL_FEE_BPS` | 50 | Fee in basis points (0.5%) |
| `MAX_PAYMENT_AGE` | 300 | Max payment validity (seconds) |

## API Endpoints

### `GET /`
Health check and service info.

```json
{
  "service": "Jeju x402 Facilitator",
  "version": "1.0.0",
  "status": "healthy",
  "network": "jeju",
  "chainId": 420691
}
```

### `GET /supported`
List supported payment schemes and networks.

```json
{
  "kinds": [
    { "scheme": "exact", "network": "jeju" },
    { "scheme": "upto", "network": "jeju" },
    { "scheme": "exact", "network": "base-sepolia" },
    { "scheme": "upto", "network": "base-sepolia" }
  ],
  "x402Version": 1
}
```

### `POST /verify`
Verify a payment without settling.

**Request:**
```json
{
  "x402Version": 1,
  "paymentHeader": "base64-encoded-payment",
  "paymentRequirements": {
    "scheme": "exact",  // or "upto" for flexible payments
    "network": "jeju",
    "maxAmountRequired": "1000000",
    "payTo": "0x...",
    "asset": "0x...",
    "resource": "/api/endpoint"
  }
}
```

**Response:**
```json
{
  "isValid": true,
  "invalidReason": null,
  "payer": "0x...",
  "amount": "1000000"
}
```

### `POST /settle`
Verify and settle a payment on-chain.

**Request:** Same as `/verify`

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "networkId": "jeju",
  "settlementId": "0x...",
  "amount": { "human": "1.00", "base": "1000000", "symbol": "USDC", "decimals": 6 },
  "fee": { "human": "0.005", "base": "5000", "bps": 50 },
  "net": { "human": "0.995", "base": "995000" }
}
```

### `POST /settle/gasless`
Settle a payment using EIP-3009 (gasless for payer). Requires EIP-3009 authorization signature.

**Request:**
```json
{
  "x402Version": 1,
  "paymentHeader": "base64-encoded-payment",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "jeju",
    "maxAmountRequired": "1000000",
    "payTo": "0x...",
    "asset": "0x...",
    "resource": "/api/endpoint"
  },
  "authParams": {
    "validAfter": 1700000000,
    "validBefore": 1700003600,
    "authNonce": "0x...",
    "authSignature": "0x..."
  }
}
```

**Response:** Same as `/settle`

## Supported Networks

| Network | Chain ID | USDC Address |
|---------|----------|--------------|
| Jeju | 420691 | 0x0165878A594ca255338adfa4d48449f69242Eb8F |
| Jeju Testnet | 420690 | - |
| Base Sepolia | 84532 | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Base | 8453 | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| Sepolia | 11155111 | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 |
| Ethereum | 1 | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |

## Payment Flow

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
│  Client  │────▶│  Server  │────▶│ Facilitator │────▶│ Contract │
└──────────┘     └──────────┘     └─────────────┘     └──────────┘
     │                │                  │                  │
     │  1. Request    │                  │                  │
     │───────────────▶│                  │                  │
     │                │                  │                  │
     │  2. 402 + Req  │                  │                  │
     │◀───────────────│                  │                  │
     │                │                  │                  │
     │  3. Sign EIP-712                  │                  │
     │──────────────────────────────────▶│                  │
     │                │                  │                  │
     │                │  4. Verify/Settle│                  │
     │                │─────────────────▶│                  │
     │                │                  │                  │
     │                │                  │  5. On-chain TX  │
     │                │                  │─────────────────▶│
     │                │                  │                  │
     │  6. Response   │                  │                  │
     │◀───────────────│◀─────────────────│◀─────────────────│
```

## Development

```bash
# Start with debug logging
NODE_ENV=development bun run dev

# Run specific test file
bun test tests/verify.test.ts

# Type check
bun run typecheck
```

## Client Integration

Use the facilitator discovery from `scripts/shared/x402-client.ts`:

```typescript
import { discoverHttpFacilitator, verifyPaymentViaHttp } from '@jeju/scripts/shared/x402-client';

// Find the best facilitator for jeju network
const facilitator = await discoverHttpFacilitator('jeju');

// Verify a payment
const result = await verifyPaymentViaHttp(
  facilitator.url,
  paymentHeader,
  paymentRequirements
);
```

## License

MIT
