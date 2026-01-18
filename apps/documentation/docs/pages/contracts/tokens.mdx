# Tokens

Token contracts for JEJU, ERC-20 factory, and token registry.

## JejuToken

The native governance and utility token for Jeju Network.

**Location:** `src/tokens/JejuToken.sol`

JejuToken is a standard ERC-20 with 18 decimals that includes ban enforcement (banned addresses cannot transfer), minting controlled by the owner (DAO timelock), and integration with BanManager for network-wide moderation.

```typescript
import { JejuTokenAbi } from '@jejunetwork/contracts';
import { getContract } from '@jejunetwork/config';

const jeju = getContract('tokens', 'jeju');

const balance = await client.readContract({
  address: jeju,
  abi: JejuTokenAbi,
  functionName: 'balanceOf',
  args: [userAddress],
});

const isBanned = await client.readContract({
  address: jeju,
  abi: JejuTokenAbi,
  functionName: 'isBanned',
  args: [userAddress],
});
```

## ERC20Factory

Deploy new ERC-20 tokens with consistent configuration.

**Location:** `src/tokens/ERC20Factory.sol`

The factory deploys standard ERC-20 tokens with automatic registration in TokenRegistry. Initial supply is minted to the deployer. Events are emitted for token tracking.

```typescript
const tx = await client.writeContract({
  address: factoryAddress,
  abi: ERC20FactoryAbi,
  functionName: 'createToken',
  args: ['My Token', 'MTK', parseEther('1000000')],
});
```

## TokenRegistry

Registry of all tokens approved for paymaster usage.

**Location:** `src/paymaster/TokenRegistry.sol`

The TokenRegistry allows registering tokens for gas payment, setting price oracles per token, configuring fee parameters, and admin controls for token management. Each token configuration includes an oracle address (Chainlink-compatible price feed), minimum and maximum fees in token units, and an enabled flag.

See [Register a Token Guide](/guides/register-token) for the full process.

## Deployment

```bash
cd packages/contracts

forge script script/DeployTokens.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast

forge script script/DeployERC20Factory.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Token Utility

JEJU serves multiple purposes: governance for voting on protocol proposals, moderation for staking in the futarchy moderation marketplace, gas payment via the paymaster, and staking for node operation rewards.
