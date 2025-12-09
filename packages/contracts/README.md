# @jejunetwork/contracts

Smart contract ABIs, types, and deployment addresses for Jeju Network.

## Installation

```bash
bun add @jejunetwork/contracts
```

## Usage

### Contract Addresses

```typescript
import { getContractAddresses, getContractAddressesByNetwork } from '@jejunetwork/contracts';

// By chain ID
const addresses = getContractAddresses(1337);
console.log(addresses.identityRegistry);
console.log(addresses.marketplace);

// By network name
const testnet = getContractAddressesByNetwork('testnet');
```

### ABIs

```typescript
import { ERC20Abi, IdentityRegistryAbi, BazaarAbi } from '@jejunetwork/contracts';

// With viem
const balance = await client.readContract({
  address: tokenAddress,
  abi: ERC20Abi,
  functionName: 'balanceOf',
  args: [userAddress],
});
```

### Types

```typescript
import type { ChainId, NetworkName, ContractAddresses } from '@jejunetwork/contracts';
import { isValidAddress, ZERO_ADDRESS, CHAIN_IDS } from '@jejunetwork/contracts';
```

## Exports

| Export | Description |
|--------|-------------|
| `ERC20Abi` | Standard ERC20 token |
| `IdentityRegistryAbi` | ERC-8004 agent registry |
| `BazaarAbi` | NFT marketplace |
| `InputSettlerAbi` | OIF intent creation |
| `OutputSettlerAbi` | OIF solver fills |
| `SolverRegistryAbi` | OIF solver staking |

## Development

```bash
# Build contracts
forge build

# Run tests
forge test

# Deploy locally
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## License

MIT
