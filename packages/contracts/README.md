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
console.log(addresses.jejuToken);

// By network name
const testnet = getContractAddressesByNetwork('testnet');
```

### ABIs

```typescript
import { ERC20Abi, IdentityRegistryAbi, BazaarAbi, JejuTokenAbi } from '@jejunetwork/contracts';

// With viem
const balance = await client.readContract({
  address: tokenAddress,
  abi: JejuTokenAbi,
  functionName: 'balanceOf',
  args: [userAddress],
});

// Check if user is banned
const isBanned = await client.readContract({
  address: jejuTokenAddress,
  abi: JejuTokenAbi,
  functionName: 'isBanned',
  args: [userAddress],
});
```

### Types

```typescript
import type { ChainId, NetworkName, ContractAddresses } from '@jejunetwork/contracts';
import { isValidAddress, ZERO_ADDRESS, CHAIN_IDS } from '@jejunetwork/contracts';
```

## Core Contracts

| Contract | Description |
|----------|-------------|
| `JejuToken` | Native ERC-20 with ban enforcement ([docs](./src/tokens/README.md)) |
| `BanManager` | Network-wide moderation system |
| `ModerationMarketplace` | Futarchy-based moderation with staking |
| `IdentityRegistry` | ERC-8004 agent identity system |
| `MultiTokenPaymaster` | ERC-4337 paymaster for gas abstraction |
| `Bazaar` | NFT marketplace |

## Exports

| Export | Description |
|--------|-------------|
| `JejuTokenAbi` | JEJU native token with ban enforcement |
| `BanManagerAbi` | Moderation ban management |
| `ModerationMarketplaceAbi` | Stake-based moderation |
| `ERC20Abi` | Standard ERC20 token |
| `IdentityRegistryAbi` | ERC-8004 agent registry |
| `BazaarAbi` | NFT marketplace |
| `InputSettlerAbi` | OIF intent creation |
| `OutputSettlerAbi` | OIF solver fills |
| `MultiTokenPaymasterAbi` | Gas payment in multiple tokens |

## Deployment

### Localnet
```bash
# Start anvil
anvil

# Deploy JejuToken
bun run scripts/deploy-jeju-token.ts --network localnet

# Deploy full system
forge script script/DeployLocalnet.s.sol --rpc-url http://localhost:9545 --broadcast
```

### Testnet
```bash
# With Safe multi-sig (recommended)
bun run scripts/deploy-jeju-token.ts --network testnet --safe 0x...

# Or with Foundry
ENABLE_FAUCET=true forge script script/DeployJejuToken.s.sol --rpc-url $RPC_URL --broadcast --verify
```

### Mainnet
```bash
# Requires Safe multi-sig
bun run scripts/deploy-jeju-token.ts --network mainnet --safe 0x...
```

See [Deployment Runbook](./DEPLOYMENT_RUNBOOK.md) for detailed instructions.

## Development

```bash
# Build contracts
forge build

# Run tests
forge test

# Run specific test
forge test --match-contract JejuToken

# Gas report
forge test --gas-report
```

## Security

- Production deployments use Safe multi-sig ownership
- BanManager integration allows network-wide moderation
- ModerationMarketplace uses futarchy for decentralized bans
- Ban-exempt addresses allow appeals via staking

## License

MIT
