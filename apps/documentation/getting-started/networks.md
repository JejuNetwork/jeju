# Networks

Jeju runs on three networks: localnet for development, testnet for staging, and mainnet for production.

## Localnet

Local development network running on chain ID 1337. Starts with `bun run dev`.

The L2 RPC is at `http://127.0.0.1:9545` with WebSocket at `ws://127.0.0.1:9546`. The L1 RPC runs at `http://127.0.0.1:8545`. The Indexer GraphQL is at `http://127.0.0.1:4350/graphql`.

Localnet features instant 2-second block times, pre-funded test accounts, all contracts deployed, and no gas costs since you're using test ETH.

```bash
bun run dev                # Start
bun run localnet:stop      # Stop
bun run localnet:reset     # Reset to fresh state
```

## Testnet

Public test network on Sepolia with chain ID 420690.

The L2 RPC is at `https://testnet-rpc.jeju.network` with WebSocket at `wss://testnet-ws.jeju.network`. The Explorer is at `https://testnet-explorer.jeju.network`. The Indexer GraphQL is at `https://testnet-indexer.jeju.network/graphql`.

To get testnet ETH, first obtain Sepolia ETH from [sepoliafaucet.com](https://sepoliafaucet.com), then bridge to Jeju testnet via Gateway.

For wallet configuration, set Network Name to "Jeju Testnet", RPC URL to `https://testnet-rpc.jeju.network`, Chain ID to `420690`, Currency Symbol to "ETH", and Explorer to `https://testnet-explorer.jeju.network`.

## Mainnet

Production network on Ethereum with chain ID 420691.

The L2 RPC is at `https://rpc.jeju.network` with WebSocket at `wss://ws.jeju.network`. The Explorer is at `https://explorer.jeju.network`. The Indexer GraphQL is at `https://indexer.jeju.network/graphql`.

For wallet configuration, set Network Name to "Jeju", RPC URL to `https://rpc.jeju.network`, Chain ID to `420691`, Currency Symbol to "ETH", and Explorer to `https://explorer.jeju.network`.

## Switching Networks

### Environment Variable

Set `JEJU_NETWORK` to switch contexts:

```bash
JEJU_NETWORK=testnet bun run scripts/deploy.ts
JEJU_NETWORK=mainnet bun run scripts/deploy.ts
```

### In Code

```typescript
import { getConfig } from '@jejunetwork/config';

const config = getConfig();
console.log(config.rpcUrl);  // Network-specific RPC
console.log(config.chainId); // Network-specific chain ID
```

### Override RPC

```bash
JEJU_RPC_URL=https://custom-rpc.example.com bun run dev
```

## External Chains

OIF (Open Intents Framework) operates across multiple chains. Users can create intents on Ethereum Sepolia (chain ID 11155111), Base Sepolia (chain ID 84532), Arbitrum Sepolia (chain ID 421614), or Optimism Sepolia (chain ID 11155420). Solvers fulfill these intents on Jeju.

## Network Selection Logic

The config package determines network in this order: first `JEJU_NETWORK` environment variable, then `NEXT_PUBLIC_NETWORK` or `VITE_NETWORK` for frontends, defaulting to `localnet`. Valid values are `localnet`, `testnet`, and `mainnet`.
