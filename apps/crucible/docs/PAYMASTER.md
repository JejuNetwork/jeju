# Paymaster System Documentation

## Overview

Crucible integrates with Jeju's standard paymaster system (`contracts/src/paymaster/`) to enable gas abstraction. Agents can pay transaction fees in elizaOS or other tokens instead of ETH.

## Architecture

The paymaster system consists of three main contracts:

1. **TokenRegistry**: Register tokens for gas payment
2. **PaymasterFactory**: Deploy token-specific paymasters
3. **LiquidityPaymaster**: ERC-4337 compliant paymaster

```
┌─────────────────────┐
│   TokenRegistry     │ ← Register tokens (USDC, elizaOS, etc.)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  PaymasterFactory   │ ← Deploy paymaster per token
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ LiquidityPaymaster  │ ← Sponsor transactions with ETH
│  LiquidityVault     │ ← Hold ETH + token liquidity
│  FeeDistributor     │ ← Split fees (50% app, 50% LPs)
└─────────────────────┘
```

## Agent Integration

### Discovery

Agents use `DISCOVER_PAYMASTERS` action:

```typescript
// Action automatically called via provider or manual trigger
const paymasters = await runtime.getService('paymaster_service')
  .getAvailablePaymasters();

// Returns:
[
  {
    address: '0x...',
    vault: '0x...',
    token: '0xe7f1...',  // elizaOS token
    tokenSymbol: 'elizaOS',
    feeMargin: 1000,  // 10%
    isOperational: true,
    entryPointBalance: '5000000000000000000',  // 5 ETH
    vaultLiquidity: '100000000000000000000'    // 100 ETH
  }
]
```

### Selection

Use `USE_PAYMASTER` action:

```typescript
// Prepare paymaster for next transaction
const result = await runtime.processAction('USE_PAYMASTER', {
  tokenAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', // elizaOS
  gasEstimate: BigInt(200000),
  gasPrice: ethers.parseUnits('1', 'gwei')
});

// Returns paymasterData for UserOperation
```

### Approval

Before first use, approve paymaster:

```typescript
const approval = await runtime.processAction('APPROVE_TOKEN', {
  tokenAddress: '0xe7f1...',  // Token to pay with
  spenderAddress: '0x...',     // Paymaster address
  amount: ethers.parseEther('1000')  // Approve 1000 tokens
});
```

## How It Works

### Phase 1: Validation

When user submits a transaction:

1. **User creates UserOperation** with `paymasterAndData`
2. **EntryPoint** calls `paymaster.validatePaymasterUserOp()`
3. **Paymaster checks**:
   - Oracle price is fresh
   - User has token balance
   - User approved paymaster
   - Vault has ETH liquidity
   - Gas cost within limits

### Phase 2: Execution

4. **EntryPoint executes** the user's transaction
5. **Transaction uses ETH** from paymaster's deposit
6. **User pays nothing in ETH**

### Phase 3: Settlement

7. **EntryPoint calls** `paymaster.postOp()`
8. **Paymaster calculates** actual token cost
9. **Paymaster transfers** tokens from user
10. **FeeDistributor splits** fees:
    - 50% to app developer
    - 50% to liquidity providers

## Cost Calculation

```solidity
function calculateElizaOSAmount(uint256 gasCostInETH) returns (uint256) {
  uint256 tokensPerETH = priceOracle.getElizaOSPerETH(); // e.g. 30,000
  uint256 baseAmount = (gasCostInETH * tokensPerETH) / 1 ether;
  uint256 margin = (baseAmount * feeMargin) / 10000;  // 10% margin
  return baseAmount + margin;
}
```

**Example**:
- Gas used: 200,000 units @ 1 gwei = 0.0002 ETH
- Price: 30,000 elizaOS per ETH
- Base cost: 0.0002 * 30,000 = 6 elizaOS
- Margin (10%): 0.6 elizaOS
- **Total**: 6.6 elizaOS

## Agent Actions

### DISCOVER_PAYMASTERS

**Purpose**: Find available paymasters  
**Validates**: PaymasterService is running  
**Returns**: List of operational paymasters

```typescript
{
  success: true,
  paymasters: [...],
  count: 2
}
```

### USE_PAYMASTER

**Purpose**: Prepare transaction for gas abstraction  
**Validates**: PaymasterService is running  
**Requires**: tokenAddress in state/message  
**Returns**: paymasterData for UserOp

```typescript
{
  success: true,
  paymaster: '0x...',
  paymasterData: '0x...',
  estimatedCost: '6600000000000000000',
  tokenSymbol: 'elizaOS'
}
```

### APPROVE_TOKEN

**Purpose**: Approve paymaster to spend tokens  
**Validates**: ApprovalService is running  
**Requires**: tokenAddress, spenderAddress  
**Returns**: Approval transaction hash

```typescript
{
  success: true,
  txHash: '0x...',
  tokenAddress: '0x...',
  spenderAddress: '0x...',
  amount: '1000000000000000000000'
}
```

## Providers

### PAYMASTER_OPTIONS

Automatically injected into agent context:

```
[PAYMASTER OPTIONS]
Available gas payment methods:
- elizaOS (ElizaOS Token): ✅ Operational, Fee: 10%
- USDC (USD Coin): ✅ Operational, Fee: 5%
[/PAYMASTER OPTIONS]
```

## Configuration

### Environment Variables

```bash
# PaymasterFactory address (from deployment)
PAYMASTER_FACTORY=0x...

# TokenRegistry address
TOKEN_REGISTRY=0x...

# Specific paymaster (optional)
LIQUIDITY_PAYMASTER=0x...
```

### Service Initialization

```typescript
// PaymasterService validates:
- JEJU_L2_RPC is set
- Factory address exists
```

If factory not configured, service starts but returns empty arrays.

## Deployment

Paymasters are deployed via the main contracts repository:

```bash
cd contracts

# Deploy paymaster system
forge script script/DeployPaymaster.s.sol \
  --broadcast \
  --rpc-url http://127.0.0.1:9545

# Addresses saved to:
# deployments/paymaster-localnet.json
```

Crucible loads addresses from this file automatically.

## Monitoring

### Check Paymaster Status

```bash
# Via API
curl http://localhost:7777/api/crucible/paymasters

# Via contract
cast call $LIQUIDITY_PAYMASTER "isOperational()" \
  --rpc-url http://127.0.0.1:9545
```

### View Liquidity

```bash
# Vault balance
cast call $LIQUIDITY_VAULT "availableETH()" \
  --rpc-url http://127.0.0.1:9545

# EntryPoint deposit
cast call $ENTRY_POINT "balanceOf(address)(uint256)" $LIQUIDITY_PAYMASTER \
  --rpc-url http://127.0.0.1:9545
```

## Troubleshooting

### "Paymaster factory not configured"
- Set `PAYMASTER_FACTORY` in .env
- Or deploy using contracts/script/DeployPaymaster.s.sol

### "No paymasters currently available"
- Factory deployed but no paymasters created
- Deploy via PaymasterFactory.deployPaymaster()

### "Insufficient allowance"
- User must approve paymaster first
- Call APPROVE_TOKEN action
- Or manually: `token.approve(paymaster, amount)`

### "Paymaster not operational"
- Check EntryPoint balance: `getStatus()`
- Refill if needed: `refillEntryPointDeposit()`
- Check vault has liquidity: `vault.availableETH()`

## Testing

```bash
# Run paymaster tests
bun test tests/scenarios/02-paymaster-gas-abstraction.test.ts
```

## References

- [LiquidityPaymaster.sol](../../contracts/src/paymaster/LiquidityPaymaster.sol)
- [PaymasterFactory.sol](../../contracts/src/paymaster/PaymasterFactory.sol)
- [TokenRegistry.sol](../../contracts/src/paymaster/TokenRegistry.sol)
- [ERC-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)

