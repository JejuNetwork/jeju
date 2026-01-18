# Smart Contracts

Jeju's smart contracts are organized into functional categories. All contracts are in `packages/contracts/src/`.

## Contract Categories

[Tokens](/contracts/tokens) handles native tokens and factories including JejuToken, ERC20Factory, and TokenRegistry. [Identity](/contracts/identity) provides ERC-8004 agent identity via IdentityRegistry and BanManager. [Payments](/contracts/payments) implements ERC-4337 paymasters including MultiTokenPaymaster and PaymasterFactory. [OIF](/contracts/oif) enables cross-chain intents with InputSettler, OutputSettler, and SolverRegistry. [EIL](/contracts/eil) manages cross-chain liquidity via L1StakeManager and CrossChainPaymaster. [Compute](/contracts/compute) powers the AI inference marketplace with ComputeRegistry and ComputeRental. [Staking](/contracts/staking) handles node operators through NodeStakingManager and AutoSlasher. [JNS](/contracts/jns) provides the name service with JNSRegistry and JNSResolver. [DeFi](/contracts/defi) integrates Uniswap V4 and pools including PoolManager integration and LiquidityVault. [Moderation](/contracts/moderation) enables content moderation via ModerationMarketplace and ReportingSystem.

## Development

Build contracts with `forge build` from the `packages/contracts` directory.

Run tests with `forge test` for all tests, `forge test --match-contract JejuToken` for a specific contract, or `forge test --gas-report` for gas analysis.

Deploy to localnet with `forge script script/DeployLocalnet.s.sol --rpc-url http://127.0.0.1:9545 --broadcast`. Deploy specific systems like OIF with `forge script script/DeployOIF.s.sol --rpc-url http://127.0.0.1:9545 --broadcast`.

For testnet, add `--verify` and use `DEPLOYER_PRIVATE_KEY` from `.env.testnet`.

## Contract Addresses

Addresses are stored in `packages/config/contracts.json` and accessible via:

```typescript
import { getContract } from '@jejunetwork/config';

const identity = getContract('registry', 'identity');
const solver = getContract('oif', 'solverRegistry');
```

See [Contract Addresses Reference](/reference/addresses) for all deployed addresses.

## ABIs

ABIs are exported from `@jejunetwork/contracts`:

```typescript
import { 
  JejuTokenAbi, 
  IdentityRegistryAbi,
  InputSettlerAbi,
  MultiTokenPaymasterAbi 
} from '@jejunetwork/contracts';

const balance = await client.readContract({
  address: tokenAddress,
  abi: JejuTokenAbi,
  functionName: 'balanceOf',
  args: [userAddress],
});
```

## Directory Structure

The `packages/contracts/` directory contains `src/` with subdirectories for tokens, registry, paymaster, oif, eil, compute, node-staking, names, amm, and moderation. The `script/` directory holds deployment scripts. The `test/` directory contains Solidity tests. The `abis/` directory has generated ABIs. The `deployments/` directory stores deployment records.

## Security

Production deployments use Gnosis Safe multi-sig ownership. Upgradeable contracts use the OpenZeppelin UUPS pattern. All contracts are audited before mainnet deployment. A bug bounty program is active.
