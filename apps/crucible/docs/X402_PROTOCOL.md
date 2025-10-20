# x402 Payment Protocol Documentation

## Overview

The x402 protocol enables micropayments for API calls and agent-to-agent (A2A) services. It uses EIP-712 signatures for secure, verifiable payment commitments with on-chain settlement.

## Protocol Flow

### 1. Discovery (No Payment)

Client makes initial request without payment:

```bash
POST /api/a2a
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "msg-123",
      "parts": [{
        "kind": "data",
        "data": {
          "skillId": "trigger-security-test",
          "params": { "contractAddress": "0x..." }
        }
      }]
    }
  },
  "id": 1
}
```

### 2. Payment Required (402 Response)

Server returns payment requirements:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": 402,
    "message": "Payment Required",
    "data": {
      "x402Version": 1,
      "error": "Payment required to access this resource",
      "accepts": [{
        "scheme": "exact",
        "network": "localnet",
        "maxAmountRequired": "10000000000000000",
        "asset": "0x0000000000000000000000000000000000000000",
        "payTo": "0x71562b71999873DB5b286dF957af199Ec94617F7",
        "resource": "/api/a2a",
        "description": "Custom security test execution",
        "mimeType": "application/json",
        "outputSchema": null,
        "maxTimeoutSeconds": 300
      }]
    }
  }
}
```

### 3. Payment Creation

Client creates and signs payment payload:

```typescript
import { createPaymentPayload, signPaymentPayload } from './lib/x402';

// Create payload
const payload = createPaymentPayload(
  '0x0000000000000000000000000000000000000000', // ETH
  '0x71562b71999873DB5b286dF957af199Ec94617F7', // payTo
  BigInt('10000000000000000'),                   // 0.01 ETH
  '/api/a2a',                                     // resource
  'localnet'                                      // network
);

// Sign with private key
const signedPayload = await signPaymentPayload(
  payload,
  '0x...'  // caller's private key
);
```

### 4. Paid Request

Client retries with payment header:

```bash
POST /api/a2a
Content-Type: application/json
X-Payment: {"scheme":"exact","network":"localnet","asset":"0x0000...","payTo":"0x7156...","amount":"10000000000000000","resource":"/api/a2a","nonce":"abc123","timestamp":1234567890,"signature":"0x..."}

{
  "jsonrpc": "2.0",
  "method": "message/send",
  ...
}
```

### 5. Server Verification & Settlement

```typescript
import { checkPayment } from './lib/x402';

// Verify and settle
const result = await checkPayment(
  req.headers['x-payment'],
  BigInt('10000000000000000'),
  '0x71562b71999873DB5b286dF957af199Ec94617F7',
  'http://127.0.0.1:9545',  // RPC URL
  runtime                    // For nonce tracking
);

if (result.paid) {
  // Execute skill
  // Return result
} else {
  // Return error
}
```

## Payment Schemes

### ETH Payment

```json
{
  "asset": "0x0000000000000000000000000000000000000000",
  "amount": "10000000000000000"
}
```

**Settlement**: Verifies signer has balance, marks nonce as used.  
**Note**: Actual ETH transfer happens separately (escrow or direct send).

### ERC-20 Payment

```json
{
  "asset": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "amount": "10000000000000000"
}
```

**Settlement**:
1. Verify signer has token balance
2. Check approval for settlement wallet
3. Execute `transferFrom(signer, payTo, amount)`
4. Mark nonce as used
5. Return settlement proof

## Security Features

### Replay Attack Prevention

Each payment includes a unique nonce:
```typescript
nonce: Math.random().toString(36).substring(7)
```

Server tracks used nonces:
- In-memory Set for fast lookup
- Database cache for persistence
- Rejects duplicate nonces

### Signature Verification

EIP-712 typed structured data:
```typescript
{
  domain: {
    name: 'x402 Payment Protocol',
    version: '1',
    chainId: 1337
  },
  types: {
    Payment: [
      { name: 'scheme', type: 'string' },
      { name: 'network', type: 'string' },
      { name: 'asset', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' }
    ]
  }
}
```

Signature recovery validates payer identity.

### Timestamp Validation

Payments expire after 5 minutes:
```typescript
const now = Math.floor(Date.now() / 1000);
if (Math.abs(now - payload.timestamp) > 300) {
  return { valid: false, error: 'Payment timestamp expired' };
}
```

## Client Usage

### Using the x402 Client

```typescript
import { callPaidSkill } from './lib/x402-client';

const result = await callPaidSkill({
  agentUrl: 'http://localhost:7777',
  skillId: 'trigger-security-test',
  params: { contractAddress: '0x...' },
  privateKey: '0x...',
  maxPayment: ethers.parseEther('0.1'),
  network: 'localnet'
});

if (result.success) {
  console.log('Skill executed:', result.data);
  console.log('Settlement:', result.settlement);
} else {
  console.error('Failed:', result.error);
}
```

### Helper Functions

```typescript
// Get vulnerability report
import { getVulnerabilityReport } from './lib/x402-client';

const report = await getVulnerabilityReport(
  'http://localhost:7777',
  'vuln-123',
  privateKey
);

// Trigger security test
import { triggerSecurityTest } from './lib/x402-client';

const test = await triggerSecurityTest(
  'http://localhost:7777',
  '0xContractAddress',
  'comprehensive',
  privateKey
);
```

## Payment Tiers

Defined in `src/lib/x402.ts`:

```typescript
SECURITY_TEST: 0.01 ETH         // Run custom security test
VULNERABILITY_REPORT: 0.05 ETH  // Get detailed report
PREMIUM_REPORT_DAILY: 0.5 ETH   // Daily premium access
CONTINUOUS_MONITORING_DAILY: 0.1 ETH
PENETRATION_TEST: 1.0 ETH       // Full contract audit
```

## Environment Variables

```bash
# Optional: wallet for settling payments
X402_SETTLEMENT_PRIVATE_KEY=0x...

# Optional: payment recipient (defaults to first guardian)
CRUCIBLE_PAYMENT_RECIPIENT=0x...
```

## Integration Examples

### Python Client

```python
import requests
from eth_account import Account
from eth_account.messages import encode_typed_data

# Create payment
payload = {
    "scheme": "exact",
    "network": "localnet",
    "asset": "0x0000000000000000000000000000000000000000",
    "payTo": "0x71562b71999873DB5b286dF957af199Ec94617F7",
    "amount": "10000000000000000",
    "resource": "/api/a2a",
    "nonce": "xyz789",
    "timestamp": int(time.time())
}

# Sign with EIP-712
account = Account.from_key(private_key)
signed = account.sign_typed_data(domain, types, payload)
payload['signature'] = signed.signature.hex()

# Make request
headers = {
    'Content-Type': 'application/json',
    'X-Payment': json.dumps(payload)
}

response = requests.post(
    'http://localhost:7777/api/a2a',
    headers=headers,
    json=rpc_request
)
```

### JavaScript/TypeScript

See `src/lib/x402-client.ts` for full implementation.

## Troubleshooting

### "Payment signature required"
- Ensure payload includes `signature` field
- Verify EIP-712 signing is correct
- Check domain.chainId matches network

### "Payment nonce already used"
- Replay attack prevented
- Generate new nonce for retry
- Check nonce is unique

### "Insufficient token balance"
- Signer doesn't have enough tokens
- Fund wallet with payment token
- Check token address is correct

### "Token approval required"
- For ERC-20 payments, must approve settlement wallet
- Call `token.approve(payTo, amount)` first
- Or use ETH instead

## Best Practices

1. **Always check 402 response** before creating payment
2. **Use unique nonces** - don't reuse payment payloads
3. **Set maxPayment** to prevent unexpected costs
4. **Handle settlement failures** - payment might be verified but not settled
5. **Store nonces** - track what you've paid for
6. **Use ETH for simplicity** - ERC-20 requires approvals

## Security Considerations

- **Signature replay**: Prevented via nonce tracking
- **Price manipulation**: Server sets prices, client decides to pay or not
- **Settlement failures**: Client verifies settlement proof in response
- **Timestamp expiry**: Prevents old payment attempts
- **Nonce collision**: Extremely unlikely with proper random generation

## References

- [x402 Specification](https://github.com/x402/spec) - Base protocol
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712) - Typed structured data signing
- [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) - Account abstraction (for paymaster)

