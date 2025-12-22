# Networks

## Network Details

| Network | Chain ID | RPC | Status |
|---------|----------|-----|--------|
| Mainnet | `420691` | `https://rpc.jejunetwork.org` | Live |
| Testnet | `420690` | `https://testnet-rpc.jejunetwork.org` | Live |
| Localnet | `1337` | `http://127.0.0.1:9545` | Local |

## Mainnet

Production network.

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
```

**RPC:** `https://rpc.jejunetwork.org`

**Block Explorer:** https://explorer.jejunetwork.org

## Testnet

Development and testing.

```typescript
const jeju = await createJejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
```

**RPC:** `https://testnet-rpc.jejunetwork.org`

**Block Explorer:** https://testnet-explorer.jejunetwork.org

**Faucet:** https://testnet-gateway.jejunetwork.org/faucet

## Localnet

Local development with Kurtosis.

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

```typescript
const jeju = await createJejuClient({
  network: 'localnet',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
});
```

**RPC:** `http://127.0.0.1:9545`

## MetaMask Configuration

### Mainnet

| Setting | Value |
|---------|-------|
| Network Name | Jeju |
| RPC URL | `https://rpc.jejunetwork.org` |
| Chain ID | `420691` |
| Currency Symbol | ETH |
| Block Explorer | `https://explorer.jejunetwork.org` |

### Testnet

| Setting | Value |
|---------|-------|
| Network Name | Jeju Testnet |
| RPC URL | `https://testnet-rpc.jejunetwork.org` |
| Chain ID | `420690` |
| Currency Symbol | ETH |
| Block Explorer | `https://testnet-explorer.jejunetwork.org` |

### Localnet

| Setting | Value |
|---------|-------|
| Network Name | Jeju Localnet |
| RPC URL | `http://127.0.0.1:9545` |
| Chain ID | `1337` |
| Currency Symbol | ETH |

## Using with viem

```typescript
import { createPublicClient, http, defineChain } from 'viem';

const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  network: 'jeju-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://testnet-explorer.jejunetwork.org' },
  },
});

const client = createPublicClient({
  chain: jejuTestnet,
  transport: http(),
});
```

## Services

| Service | Localnet | Testnet | Mainnet |
|---------|----------|---------|---------|
| RPC | :9545 | testnet-rpc.jejunetwork.org | rpc.jejunetwork.org |
| Gateway | :4001 | testnet-gateway.jejunetwork.org | gateway.jejunetwork.org |
| Bazaar | :4006 | testnet-bazaar.jejunetwork.org | bazaar.jejunetwork.org |
| Indexer | :4350 | testnet-indexer.jejunetwork.org | indexer.jejunetwork.org |

---

<details>
<summary>📋 Copy as Context</summary>

```
Jeju Networks

Mainnet: Chain ID 420691, https://rpc.jejunetwork.org
Testnet: Chain ID 420690, https://testnet-rpc.jejunetwork.org
Localnet: Chain ID 1337, http://127.0.0.1:9545

SDK:
const jeju = await createJejuClient({ network: 'testnet', privateKey: '0x...' });

viem:
const jejuTestnet = defineChain({
  id: 420690,
  rpcUrls: { default: { http: ['https://testnet-rpc.jejunetwork.org'] } }
});

Faucet: https://testnet-gateway.jejunetwork.org/faucet
```

</details>
