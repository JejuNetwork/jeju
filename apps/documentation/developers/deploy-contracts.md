# Deploy Contracts

## Localnet

Auto-deployed on `bun run dev`. Addresses in `packages/contracts/deployments/`.

## Testnet

```bash
export DEPLOYER_PRIVATE_KEY=0x...

cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast
```

Get testnet ETH: https://www.alchemy.com/faucets/base-sepolia

## Mainnet

```bash
export DEPLOYER_PRIVATE_KEY=0x...

cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.jeju.network \
  --broadcast \
  --verify
```

## Verify

```bash
forge verify-contract <address> <Contract> --chain-id 420690
```

## Access Addresses

```typescript
import { getContractAddress } from '@jejunetwork/config';

const registry = getContractAddress('identityRegistry');
```

Addresses saved to `packages/contracts/deployments/<network>/deployment.json`.
