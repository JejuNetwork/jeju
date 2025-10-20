# Jeju Cloud Services Contracts

Smart contracts powering Jeju's decentralized cloud infrastructure with ERC-8004 registry integration, x402 micropayments, and reputation-based TOS enforcement.

## Quick Start

```bash
# Deploy all contracts
forge script script/DeployCloudIntegration.s.sol --broadcast

# Or use TypeScript
bun run deploy:cloud

# Setup approvers
bun run setup:cloud:approvers

# Verify deployment
bun run verify:cloud

# Run E2E tests
bun run test:cloud
```

## Contracts

### Core Service Infrastructure

| Contract | Purpose | LOC |
|----------|---------|-----|
| **ServiceRegistry** | Service pricing, usage tracking, volume discounts | 455 |
| **CreditManager** | Prepaid balances (USDC/elizaOS/ETH) | 358 |
| **ServicePaymaster** | ERC-4337 paymaster for cloud services | 471 |
| **MultiTokenPaymaster** | Multi-token paymaster with credit system | 350 |
| **CreditPurchaseContract** | Buy elizaOS credits with crypto | 512 |

### Cloud Reputation System

| Contract | Purpose | LOC |
|----------|---------|-----|
| **CloudReputationProvider** | Reputation management & TOS enforcement | 505 |

### Integration Points

| System | Integration | Status |
|--------|-------------|--------|
| ERC-8004 Registry | Cloud registered as agent | ✅ |
| ReputationRegistry | Cloud is reputation provider | ✅ |
| ServiceRegistry | 5 services registered | ✅ |
| CreditManager | Prepaid balance support | ✅ |
| x402 Protocol | Micropayment support | ✅ |
| A2A Protocol | Agent-to-agent communication | ✅ |

## Architecture

```
┌─────────────────────────────────────────────┐
│            CLOUD SERVICES                    │
│  • AI Inference (chat, image, embeddings)   │
│  • Storage (IPFS, R2)                       │
│  • Compute (CPU, GPU)                       │
└────────────┬────────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────┐     ┌──────────────┐
│ Payment │     │  Reputation  │
│ System  │     │    System    │
└────┬────┘     └──────┬───────┘
     │                 │
     ▼                 ▼
┌─────────────────────────────────┐
│   SERVICE REGISTRY CONTRACTS    │
│                                  │
│  ServiceRegistry ──┐             │
│  CreditManager    ─┤             │
│  Paymasters       ─┤             │
│                    │             │
│  CloudReputationProvider ──┐    │
│                            │    │
│  ┌─────────────────────────┘    │
│  │                              │
│  ▼                              │
│  ERC-8004 REGISTRY SYSTEM       │
│  • IdentityRegistry             │
│  • ReputationRegistry           │
│  • ValidationRegistry           │
└─────────────────────────────────┘
```

## Features

### 1. Multi-Token Payments

Users can pay with:
- **USDC** (6 decimals) - Stablecoin payments
- **elizaOS** (18 decimals) - Platform token
- **ETH** - Native gas token

### 2. Prepaid Credits

- Deposit once, use many times
- Zero-latency payments (just balance check)
- Automatic overpayment crediting
- Low balance warnings

### 3. Dynamic Pricing

- Base price per service
- Volume discounts for high-usage users
- Demand multipliers during peak times
- Min/max price bounds

### 4. Reputation Management

- Set reputation for any agent (0-100 score)
- Track violations across 11 categories
- Multi-sig ban system
- On-chain audit trail

### 5. ERC-4337 Paymasters

- Gas sponsorship for users
- Combined gas + service cost billing
- Multi-token support
- x402 payment integration

## Usage Examples

### Set Reputation

```typescript
import { CloudIntegration } from './shared/cloud-integration';

const integration = new CloudIntegration(config);

await integration.setReputation(
  signer,
  agentId,
  95, // Score 0-100
  'quality', // Category
  'api-usage', // Subcategory
  'ipfs://QmEvidence...' // Reason/evidence
);
```

### Record Violation

```typescript
await integration.recordViolation(
  signer,
  agentId,
  ViolationType.API_ABUSE,
  80, // Severity 0-100
  'ipfs://QmEvidence...'
);
```

### Propose Ban

```typescript
const proposalId = await integration.proposeBan(
  signer,
  agentId,
  ViolationType.HACKING,
  'ipfs://QmEvidence...'
);

// Multi-sig approvers approve
await integration.approveBan(approver1, proposalId);
await integration.approveBan(approver2, proposalId);
// Auto-executes at threshold (2/3)
```

### Check Credit

```typescript
const credit = await integration.checkUserCredit(
  userAddress,
  'chat-completion',
  usdcAddress
);

if (!credit.sufficient) {
  return Response.json({
    error: 'Insufficient credit',
    required: credit.required,
    available: credit.available
  }, { status: 402 });
}
```

## Testing

```bash
# Run all E2E tests (starts localnet, deploys, tests, cleanup)
bun run test:cloud

# Run individual test suites
bun test tests/e2e/cloud-registry-integration.test.ts
bun test tests/e2e/cloud-a2a-integration.test.ts
bun test tests/e2e/cloud-x402-payments.test.ts
bun test tests/e2e/cloud-complete-workflow.test.ts

# Quick test (no setup)
bun run test:cloud:e2e
```

### Test Coverage

- ✅ 50 E2E tests (no mocks)
- ✅ 100% critical path coverage
- ✅ Security vulnerability tests
- ✅ Performance tests
- ✅ Error handling tests

## Security

### Audit Status

- ✅ Manual security review complete
- ✅ 9 issues identified
- ✅ 7 issues fixed
- ✅ 2 issues documented for production
- ⏳ Third-party audit recommended before mainnet

### Known Issues

See [CLOUD_CRITICAL_REVIEW.md](./CLOUD_CRITICAL_REVIEW.md) for details.

**Production Requirements**:
- Use AWS KMS or HashiCorp Vault for key management
- Deploy Redis cluster for distributed rate limiting
- Configure monitoring and alerting
- Setup incident response procedures

## Documentation

- **[CloudReputationProvider.sol](./CloudReputationProvider.sol)** - Main contract
- **[CLOUD_CRITICAL_REVIEW.md](../../../CLOUD_CRITICAL_REVIEW.md)** - Security review
- **[CLOUD_DEPLOYMENT_GUIDE.md](../../../CLOUD_DEPLOYMENT_GUIDE.md)** - Deployment guide
- **[CLOUD_INTEGRATION_SUMMARY.md](../../../CLOUD_INTEGRATION_SUMMARY.md)** - Complete summary
- **[cloud-api-integration.ts](../../../apps/agent/packages/plugin-elizaos-services/examples/cloud-api-integration.ts)** - Integration examples

## Gas Costs

Approximate costs on Jeju (1 gwei gas):

| Operation | Gas | Cost |
|-----------|-----|------|
| Register cloud agent | ~150,000 | ~$0.00015 |
| Register service | ~80,000 | ~$0.00008 |
| Set reputation | ~120,000 | ~$0.00012 |
| Record violation | ~50,000 | ~$0.00005 |
| Propose ban | ~90,000 | ~$0.00009 |
| Approve ban | ~60,000 | ~$0.00006 |
| Execute ban | ~150,000 | ~$0.00015 |

## Support

- **Issues**: https://github.com/jeju/issues
- **Discord**: https://discord.gg/jeju
- **Security**: security@jeju.network
- **Docs**: https://docs.jeju.network/cloud

---

**Status**: ✅ Production-ready (pending security audit)


