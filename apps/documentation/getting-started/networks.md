# Networks

Connect to Jeju networks for development, testing, and production.

## Network Overview

| Network | Chain ID | Use |
|---------|----------|-----|
| Mainnet | 420691 | Production |
| Testnet | 420690 | Staging, testing |
| Localnet | 1337 | Development |

## Mainnet

Production network for real transactions.

### RPC Endpoints

| Provider | URL |
|----------|-----|
| Primary | `https://rpc.jejunetwork.org` |
| WebSocket | `wss://rpc.jejunetwork.org` |

### Add to Wallet

| Setting | Value |
|---------|-------|
| Network Name | Jeju Mainnet |
| RPC URL | `https://rpc.jejunetwork.org` |
| Chain ID | 420691 |
| Currency Symbol | ETH |
| Block Explorer | `https://explorer.jejunetwork.org` |

### Services

| Service | URL |
|---------|-----|
| Explorer | https://explorer.jejunetwork.org |
| Indexer | https://indexer.jejunetwork.org/graphql |
| Gateway | https://gateway.jejunetwork.org |
| Bazaar | https://bazaar.jejunetwork.org |

## Testnet

Free tokens for testing. Use before deploying to mainnet.

### RPC Endpoints

| Provider | URL |
|----------|-----|
| Primary | `https://testnet-rpc.jejunetwork.org` |
| WebSocket | `wss://testnet-rpc.jejunetwork.org` |

### Add to Wallet

| Setting | Value |
|---------|-------|
| Network Name | Jeju Testnet |
| RPC URL | `https://testnet-rpc.jejunetwork.org` |
| Chain ID | 420690 |
| Currency Symbol | ETH |
| Block Explorer | `https://testnet-explorer.jejunetwork.org` |

### Get Test Tokens

```bash
# Via CLI
jeju faucet 0xYourAddress

# Via Gateway UI
# Visit https://testnet-gateway.jejunetwork.org/faucet
```

### Services

| Service | URL |
|---------|-----|
| Explorer | https://testnet-explorer.jejunetwork.org |
| Indexer | https://testnet-indexer.jejunetwork.org/graphql |
| Gateway | https://testnet-gateway.jejunetwork.org |
| Faucet | https://testnet-gateway.jejunetwork.org/faucet |

## Localnet

For local development. Runs entirely on your machine.

### Start Localnet

```bash
git clone https://github.com/elizaos/jeju
cd jeju
bun install
bun run dev
```

### RPC Endpoints

| Provider | URL |
|----------|-----|
| L2 RPC | `http://127.0.0.1:9545` |
| L1 RPC | `http://127.0.0.1:8545` |
| WebSocket | `ws://127.0.0.1:9545` |

### Add to Wallet

| Setting | Value |
|---------|-------|
| Network Name | Jeju Localnet |
| RPC URL | `http://127.0.0.1:9545` |
| Chain ID | 1337 |
| Currency Symbol | ETH |

### Test Accounts

Pre-funded with 10,000 ETH each:

| Role | Address | Private Key |
|------|---------|-------------|
| Deployer | `0xf39F...2266` | `0xac09...ff80` |
| User 1 | `0x70997...79C8` | `0x59c6...e64e` |
| User 2 | `0x3C44...F56a` | `0x5de4...4a6f` |

Full list: `bun run jeju keys`

## SDK Configuration

### Connect to Network

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

// Mainnet
const mainnet = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY,
});

// Testnet
const testnet = await createJejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY,
});

// Localnet
const localnet = await createJejuClient({
  network: 'localnet',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
});
```

### Custom RPC

```typescript
const client = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY,
  rpcUrl: 'https://my-custom-rpc.example.com',
});
```

## Viem Configuration

```typescript
import { defineChain } from 'viem';

export const jejuMainnet = defineChain({
  id: 420691,
  name: 'Jeju Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.jejunetwork.org' },
  },
});

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://testnet-explorer.jejunetwork.org' },
  },
  testnet: true,
});
```

## Ethers.js Configuration

```typescript
import { ethers } from 'ethers';

// Mainnet
const mainnetProvider = new ethers.JsonRpcProvider(
  'https://rpc.jejunetwork.org',
  420691
);

// Testnet
const testnetProvider = new ethers.JsonRpcProvider(
  'https://testnet-rpc.jejunetwork.org',
  420690
);
```

## Related

- [Quick Start](/getting-started/quick-start) - Local development setup
- [SDK Installation](/build/sdk/installation) - SDK setup
- [Deploy Contracts](/deployment/overview) - Deployment guide

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Networks

Mainnet (Production):
- Chain ID: 420691
- RPC: https://rpc.jejunetwork.org
- Explorer: https://explorer.jejunetwork.org
- Indexer: https://indexer.jejunetwork.org/graphql

Testnet (Staging):
- Chain ID: 420690
- RPC: https://testnet-rpc.jejunetwork.org
- Explorer: https://testnet-explorer.jejunetwork.org
- Faucet: https://testnet-gateway.jejunetwork.org/faucet

Localnet (Development):
- Chain ID: 1337
- RPC: http://127.0.0.1:9545
- Start: bun run dev

SDK:
const jeju = await createJejuClient({
  network: 'mainnet', // or 'testnet', 'localnet'
  privateKey: '0x...',
});

Test Accounts (localnet):
Deployer: 0xf39F...2266, key: 0xac09...ff80
Pre-funded with 10,000 ETH

Wallet Settings:
Network Name: Jeju Mainnet/Testnet
Currency Symbol: ETH
```

</details>
