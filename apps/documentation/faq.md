# FAQ

> **TL;DR:** Jeju is an L2 with 200ms blocks, gasless tx (pay in any token), agent identity (ERC-8004), and cross-chain intents (ERC-7683). RPC at `rpc.jeju.network` (mainnet) or `testnet-rpc.jeju.network` (testnet).

## Quick Answers

### What is Jeju?
Ethereum L2 on OP-Stack. 200ms flashblocks. Native paymasters for gasless tx. ERC-8004 agent identity. ERC-7683 intents.

### Chain IDs?
- Localnet: `1337`
- Testnet: `420690`
- Mainnet: `420691`

### RPC URLs?
```typescript
const RPC = {
  localnet: 'http://127.0.0.1:9545',
  testnet: 'https://testnet-rpc.jeju.network',
  mainnet: 'https://rpc.jeju.network',
};
```

### How to pay gas without ETH?
Use paymaster:
```typescript
const tx = await wallet.sendTransaction({
  to: recipient,
  value: amount,
  paymaster: MULTI_TOKEN_PAYMASTER,
  paymasterInput: encodePaymasterInput({ token: USDC, maxAmount: parseUnits('5', 6) }),
});
```

### How fast are transactions?
- 200ms: Flashblock pre-confirmation
- 2s: Full block
- 7 days: L1 finality (for withdrawals)

### How to bridge assets?
Fast (via XLPs): Instant, ~0.1% fee. Use gateway.jeju.network.
Standard: 7-day withdrawal. Use native bridge contracts.

### How to deploy contracts?
```bash
forge create src/MyContract.sol:MyContract \
  --rpc-url https://rpc.jeju.network \
  --private-key $PRIVATE_KEY \
  --verify
```

### How to register an agent?
```typescript
await identityRegistry.register(
  'MyAgent',
  'Description',
  'https://myagent.com/a2a',
  'https://myagent.com/mcp',
  'ipfs://metadata'
);
```

### How to query blockchain data?
GraphQL at `/graphql`:
```graphql
query { blocks(limit: 10) { number hash timestamp } }
```

### What tokens can be used for gas?
ETH (native), USDC, JEJU, elizaOS, or any token registered in TokenRegistry.

## Common Errors

### AA21: Insufficient token balance
User doesn't have enough tokens to pay paymaster. Check balance.

### AA31: Paymaster validation failed
Oracle price stale or paymaster misconfigured.

### AA33: Paymaster needs refill
Paymaster operator needs to deposit more ETH.

### Transaction pending forever
1. Check gas price: `cast gas-price --rpc-url $RPC`
2. If using paymaster, verify token balance
3. Try higher gas price

### Bridge transfer stuck
1. Check L1 tx confirmed
2. Wait 2 min for L2 indexing
3. If fast bridge, check XLP liquidity

### Contract verification failed
```bash
forge verify-contract $ADDRESS src/Contract.sol:Contract \
  --chain-id 420691 \
  --etherscan-api-key $KEY \
  --constructor-args $(cast abi-encode "constructor(uint256)" 123)
```

## Network Configuration

### Viem
```typescript
import { defineChain } from 'viem';

export const jeju = defineChain({
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.jeju.network'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.jeju.network' } },
});
```

### MetaMask
```
Network Name: Jeju
RPC URL: https://rpc.jeju.network
Chain ID: 420691
Currency: ETH
Explorer: https://explorer.jeju.network
```

## Test Accounts (Localnet Only)

```typescript
const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    balance: '10000 ETH',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    balance: '10000 ETH',
  },
];
// Mnemonic: test test test test test test test test test test test junk
```

## Services

| Service | Local | Testnet | Mainnet |
|---------|-------|---------|---------|
| RPC | localhost:9545 | testnet-rpc.jeju.network | rpc.jeju.network |
| Indexer | localhost:4350/graphql | testnet-indexer.jeju.network/graphql | indexer.jeju.network/graphql |
| Gateway | localhost:4001 | testnet-gateway.jeju.network | gateway.jeju.network |
| Explorer | - | testnet-explorer.jeju.network | explorer.jeju.network |

## Help

- Discord: discord.gg/elizaos
- GitHub: github.com/elizaos/jeju/issues
- Status: status.jeju.network
