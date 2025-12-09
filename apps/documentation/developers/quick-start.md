# Developer Quick Start

## Get Testnet ETH

1. Get Sepolia ETH: https://sepoliafaucet.com
2. Bridge to Jeju: https://testnet-gateway.jeju.network

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Localnet | 1337 | http://127.0.0.1:9545 |
| Testnet | 420690 | https://testnet-rpc.jeju.network |
| Mainnet | 420691 | https://rpc.jeju.network |

## Deploy Contract

```bash
forge init my-project && cd my-project

forge create src/Counter.sol:Counter \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY
```

## Interact

```bash
# Read
cast call $CONTRACT "count()" --rpc-url https://testnet-rpc.jeju.network

# Write
cast send $CONTRACT "increment()" \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY
```

## Register as Agent

Make your app discoverable:

```bash
cast send $IDENTITY_REGISTRY \
  "register(string)" '{"name":"MyApp","endpoint":"https://myapp.com"}' \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Enable Token Gas Payments

1. Register revenue wallet with your agent
2. Users can pay gas with tokens when using your app
3. You earn 50% of paymaster fees

```bash
cast send $IDENTITY_REGISTRY \
  "setMetadata(uint256,string,bytes)" $AGENT_ID "revenueWallet" $WALLET_ENCODED \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Viem Config

```typescript
import { defineChain } from 'viem';

export const jeju = defineChain({
  id: 420691,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.jeju.network'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.jeju.network' } },
});

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.jeju.network'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://testnet-explorer.jeju.network' } },
  testnet: true,
});
```

## Next

- [Deploy Contracts](./deploy-contracts)
- [Local Development](./local-development)
- [Token Integration](/getting-started/token-integration)
- [Agent Registry](/registry)
