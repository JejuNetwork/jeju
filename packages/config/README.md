# Config

Jeju network configuration. No `.env` needed.

## Usage

```typescript
import { getRpcUrl, getChainId, getContractAddress } from '@jejunetwork/config';

const rpc = getRpcUrl();           // http://127.0.0.1:9545
const chainId = getChainId();      // 1337
const addr = getContractAddress('identityRegistry');
```

## Files

```
packages/config/
├── chain/
│   ├── localnet.json
│   ├── testnet.json
│   └── mainnet.json
├── ports.ts
├── tokens.json
└── network.ts
```

## Network Config

JSON files, not environment variables:

```json
{
  "chainId": 420690,
  "rpcUrl": "https://testnet-rpc.jeju.network",
  "l1ChainId": 11155111
}
```

## Contract Addresses

Auto-loaded from `packages/contracts/deployments/<network>/`.

```typescript
import { loadDeployedContracts } from '@jejunetwork/config';

const contracts = loadDeployedContracts('testnet');
```

## Test Accounts

```typescript
import { TEST_ACCOUNTS } from '@jejunetwork/config';

TEST_ACCOUNTS.DEPLOYER.address    // 0xf39F...2266
TEST_ACCOUNTS.DEPLOYER.privateKey // 0xac09...ff80
```

## Environment Overrides

Override any default:

```bash
JEJU_RPC_URL=http://my-node:8545 bun run dev
JEJU_NETWORK=testnet bun run dev
GATEWAY_PORT=5001 bun run dev
```
