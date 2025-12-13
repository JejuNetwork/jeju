# Facilitator

Facilitator is the x402 payment verification and settlement service. When services require payment via the x402 protocol, the Facilitator verifies EIP-712 signatures and executes on-chain settlement.

**URLs:** Localnet at http://127.0.0.1:3402, testnet at https://facilitator-testnet.jeju.network, mainnet at https://facilitator.jeju.network

## How It Works

The x402 payment flow works like this: a server returns 402 with payment requirements, the client signs an EIP-712 payment, the client includes the payment in the X-Payment header, the server sends the payment to the Facilitator, the Facilitator verifies the signature and settles on-chain, then the server receives confirmation and returns the response to the client.

The Facilitator supports multiple networks (Jeju, Base, Ethereum), gasless settlement via EIP-3009, and configurable protocol fees.

## API Endpoints

### Health Check

```bash
curl http://localhost:3402/
```

Returns service status, version, network, and chain ID.

### Supported Networks

```bash
curl http://localhost:3402/supported
```

Returns supported payment schemes and networks with the x402 version.

### Verify Payment

```bash
curl -X POST http://localhost:3402/verify \
  -H "Content-Type: application/json" \
  -d '{
    "x402Version": 1,
    "paymentHeader": "base64-encoded-payment",
    "paymentRequirements": {
      "scheme": "exact",
      "network": "jeju",
      "maxAmountRequired": "1000000",
      "payTo": "0x...",
      "asset": "0x...",
      "resource": "/api/endpoint"
    }
  }'
```

Returns whether the payment is valid, the payer address, and the amount.

### Settle Payment

```bash
curl -X POST http://localhost:3402/settle \
  -H "Content-Type: application/json" \
  -d '{
    "x402Version": 1,
    "paymentHeader": "base64-encoded-payment",
    "paymentRequirements": {...}
  }'
```

Returns success status, transaction hash, settlement ID, amount with symbol, fee details, and net amount.

### Gasless Settlement

For EIP-3009 gasless transfers (payer doesn't pay gas):

```bash
curl -X POST http://localhost:3402/settle/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "x402Version": 1,
    "paymentHeader": "base64-encoded-payment",
    "paymentRequirements": {...},
    "authParams": {
      "validAfter": 1700000000,
      "validBefore": 1700003600,
      "authNonce": "0x...",
      "authSignature": "0x..."
    }
  }'
```

### Stats

```bash
curl http://localhost:3402/stats
```

Returns payments verified, payments settled, total volume, and fees collected.

## Integration

### Server Middleware

```typescript
import { verifyPayment, settlePayment } from '@jeju/x402';

async function x402Middleware(req, res, next) {
  const requirements = getRequirements(req);
  const payment = req.headers['x-payment'];
  
  if (!payment) {
    return res.status(402).json({
      error: 'Payment required',
      paymentRequirements: requirements,
    });
  }
  
  const verification = await verifyPayment(payment, requirements);
  if (!verification.isValid) {
    return res.status(400).json({ error: verification.invalidReason });
  }
  
  const settlement = await settlePayment(payment, requirements);
  if (!settlement.success) {
    return res.status(500).json({ error: 'Settlement failed' });
  }
  
  next();
}
```

### Client

```typescript
import { X402Client } from '@jeju/x402-client';

const client = new X402Client({ wallet });

const response = await client.fetch('https://api.example.com/paid', {
  method: 'POST',
  body: JSON.stringify(data),
});
```

## Supported Networks

Jeju mainnet (chain ID 420691), Jeju testnet (chain ID 420690), Base Sepolia (chain ID 84532), Base mainnet (chain ID 8453), Sepolia (chain ID 11155111), and Ethereum mainnet (chain ID 1) are all supported. Each network has its own USDC contract address.

## Setup & Configuration

Install with `cd apps/facilitator && bun install`.

### Required Secrets

`FACILITATOR_PRIVATE_KEY` is required for the hot wallet that pays gas for settlements. Never commit this key.

### Environment Variables

```bash
FACILITATOR_PORT=3402           # HTTP port
X402_FACILITATOR_ADDRESS=0x...  # Contract address
JEJU_RPC_URL=http://127.0.0.1:9545
FACILITATOR_PRIVATE_KEY=0x...   # Hot wallet for gas
PROTOCOL_FEE_BPS=50             # 0.5% fee (50 basis points)
MAX_PAYMENT_AGE=300             # 5 minute validity window
```

### Running Development

```bash
bun run dev
```

### Running Production

```bash
bun run build
bun run start
```

## Testing

Run unit tests with `bun test`. Run type checking with `bun run typecheck`.

## Deployment

### Localnet

Facilitator starts automatically with `bun run dev` from the root.

### Testnet/Mainnet

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l component=facilitator sync
```

Configure secrets in AWS Secrets Manager:
- `jeju/testnet/facilitator/private-key` for the hot wallet key
- Ensure the hot wallet has ETH for gas

## Error Handling

Code 400 for invalid payment signature, expired payment, insufficient balance, or already settled payments. Code 500 for settlement failures.

## Common Issues

"Invalid payment signature" means the EIP-712 signature doesn't match. Check that the domain, types, and message match between client and server.

"Payment expired" means the payment's validBefore timestamp has passed. Increase MAX_PAYMENT_AGE or ensure clocks are synchronized.

"Settlement failed" usually means the hot wallet lacks ETH for gas, the token contract rejected the transfer, or there's network congestion.
