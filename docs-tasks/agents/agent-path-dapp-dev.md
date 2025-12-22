# Agent Task: DApp Developer Path Documentation

## Scope
Create documentation path for developers building dapps who want an alternative to Privy, Alchemy, etc.

## Target Audience
- Web3 developers familiar with Ethereum
- Looking for SDK, RPC, infrastructure services
- Want gasless transactions, account abstraction
- Need reliable RPC endpoints
- Want decentralized alternatives to centralized services

## User Journey
1. Discover Jeju as alternative to Privy/Alchemy
2. Understand value proposition
3. Get started with SDK
4. Use RPC endpoints
5. Integrate gasless transactions
6. Deploy and scale

## Output Files

### 1. `apps/documentation/build/overview.md`

```markdown
# Build on Jeju

Jeju provides everything you need to build Web3 apps—without centralized services.

## Why Jeju for DApp Developers?

### vs. Alchemy/Infura
- Decentralized RPC network
- No API keys required
- Same reliability, no vendor lock-in

### vs. Privy/Dynamic
- Native wallet connection via OAuth3
- Built-in account abstraction
- Gasless transactions out of the box

### vs. Thirdweb
- Full SDK with DeFi, compute, storage
- Cross-chain intents built-in
- Deploy your own contracts

## Quick Start

\`\`\`bash
bun add @jejunetwork/sdk
\`\`\`

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'mainnet',
  // Optional: Add wallet for signing
  privateKey: process.env.PRIVATE_KEY,
});

// Read blockchain data
const balance = await client.getBalance(address);

// Gasless transaction
await client.payments.sponsoredTransfer({
  to: recipient,
  amount: parseEther('1'),
});
\`\`\`

## What's Available

### RPC Endpoints
Reliable, decentralized RPC at:
- Mainnet: `https://rpc.jejunetwork.org`
- Testnet: `https://testnet-rpc.jejunetwork.org`

### SDK Modules
- **Payments** - Gasless transfers, paymasters
- **Identity** - Wallet auth, ERC-8004 agents
- **DeFi** - Swaps, pools, staking
- **Compute** - AI inference API
- **Storage** - IPFS, decentralized storage
- **Cross-chain** - Intent-based transfers

### DWS (Decentralized Web Services)
- Compute containers
- Storage buckets
- CDN
- All payable in tokens

## Learning Path

1. [Install SDK](/build/sdk/installation)
2. [Connect Wallet](/build/sdk/client)
3. [Gasless Transactions](/build/sdk/payments)
4. [Use DeFi](/build/sdk/defi)
5. [Deploy Contracts](/deployment/contracts)

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/build/rpc/endpoints.md`

```markdown
# RPC Endpoints

Use Jeju RPC endpoints in your dapp.

## Endpoints

| Network | URL | Chain ID |
|---------|-----|----------|
| Mainnet | `https://rpc.jejunetwork.org` | 420691 |
| Testnet | `https://testnet-rpc.jejunetwork.org` | 420690 |

## Usage with Popular Libraries

### viem
\`\`\`typescript
import { createPublicClient, http } from 'viem';
import { jeju } from '@jejunetwork/config/chains';

const client = createPublicClient({
  chain: jeju,
  transport: http('https://rpc.jejunetwork.org'),
});
\`\`\`

### ethers.js
\`\`\`typescript
import { JsonRpcProvider } from 'ethers';

const provider = new JsonRpcProvider('https://rpc.jejunetwork.org');
\`\`\`

### wagmi
\`\`\`typescript
import { configureChains, createConfig } from 'wagmi';
import { jeju } from '@jejunetwork/config/chains';
import { publicProvider } from 'wagmi/providers/public';

const { chains, publicClient } = configureChains(
  [jeju],
  [publicProvider()]
);
\`\`\`

## vs. Centralized Providers

| Feature | Jeju | Alchemy/Infura |
|---------|------|----------------|
| API Keys | Not required | Required |
| Rate Limits | Community-based | Tiered |
| Decentralized | Yes | No |
| Pricing | Free/token-based | Subscription |

## Run Your Own Node

For maximum decentralization, run your own node:

\`\`\`bash
# See full guide at /operate/rpc-node
jeju node start --type rpc
\`\`\`

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/build/dws/overview.md`

```markdown
# DWS (Decentralized Web Services)

Cloud services without the cloud vendor lock-in.

## What is DWS?

DWS provides AWS/GCP-like services on a decentralized network:
- **Compute** - Run containers, serverless functions
- **Storage** - IPFS-backed object storage
- **CDN** - Edge caching and delivery
- **Databases** - Managed databases

All payable in JEJU or USDC.

## Quick Start

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({ network: 'mainnet' });

// Deploy a container
const container = await client.dws.deploy({
  image: 'myapp:latest',
  ports: [3000],
  env: { NODE_ENV: 'production' },
});

console.log(`Running at: ${container.url}`);
\`\`\`

## Pricing

| Service | Price |
|---------|-------|
| Compute (per hour) | 0.01 USDC |
| Storage (per GB/month) | 0.02 USDC |
| Bandwidth (per GB) | 0.001 USDC |

## vs. AWS/GCP

| Feature | DWS | AWS/GCP |
|---------|-----|---------|
| Vendor lock-in | No | Yes |
| Payment | Crypto | Credit card |
| Censorship | Resistant | Subject to ToS |
| Pricing | Transparent | Complex |

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/path-dapp-dev.md`

