# Contracts

Smart contract ABIs, types, and deployment addresses for Jeju Network.

## Installation

```bash
bun add @jejunetwork/contracts
```

## Usage

### Contract Addresses

```typescript
import { 
  getContractAddresses, 
  getContractAddressesByNetwork 
} from '@jejunetwork/contracts';

// By chain ID
const addresses = getContractAddresses(420691);
console.log(addresses.identityRegistry);
console.log(addresses.tokenRegistry);
console.log(addresses.jejuToken);

// By network name
const testnet = getContractAddressesByNetwork('testnet');
```

### ABIs

```typescript
import { 
  JejuTokenAbi, 
  IdentityRegistryAbi, 
  BazaarAbi,
  InputSettlerAbi,
  OutputSettlerAbi,
  MultiTokenPaymasterAbi,
} from '@jejunetwork/contracts';

// With viem
const balance = await client.readContract({
  address: tokenAddress,
  abi: JejuTokenAbi,
  functionName: 'balanceOf',
  args: [userAddress],
});
```

## Contract Categories

### Tokens

| Contract | Description |
|----------|-------------|
| `JejuToken` | Native ERC-20 with ban enforcement |
| `TokenRegistry` | Registered tokens for paymasters |
| `ERC20Factory` | Deploy new tokens |

### Identity (ERC-8004)

| Contract | Description |
|----------|-------------|
| `IdentityRegistry` | Agent registration and metadata |
| `ReputationRegistry` | Reputation labels |
| `ValidationRegistry` | Agent validation |

### Payments

| Contract | Description |
|----------|-------------|
| `MultiTokenPaymaster` | ERC-4337 paymaster for gas abstraction |
| `SponsoredPaymaster` | Sponsor gas for users |
| `PaymasterFactory` | Deploy app-specific paymasters |

### OIF (Cross-chain Intents)

| Contract | Description |
|----------|-------------|
| `InputSettler` | Create intents on source chain |
| `OutputSettler` | Fill intents on destination |
| `SolverRegistry` | Solver registration and staking |
| `OracleAdapter` | Cross-chain attestation |

### EIL (Instant Bridging)

| Contract | Description |
|----------|-------------|
| `L1StakeManager` | XLP staking on L1 |
| `CrossChainPaymaster` | Credit users on L2 |
| `LiquidityVault` | XLP liquidity management |

### DeFi

| Contract | Description |
|----------|-------------|
| `Bazaar` | NFT marketplace |
| `LiquidityAggregator` | DEX aggregation |
| `BondingCurve` | Token launch curves |

### Governance

| Contract | Description |
|----------|-------------|
| `Council` | DAO governance |
| `GovernanceTimelock` | Execution delay |
| `DAORegistry` | DAO registration |

### Moderation

| Contract | Description |
|----------|-------------|
| `BanManager` | Network-wide bans |
| `ModerationMarketplace` | Futarchy-based moderation |
| `EvidenceRegistry` | Moderation evidence |

### JNS (Name Service)

| Contract | Description |
|----------|-------------|
| `JNSRegistry` | Domain ownership |
| `JNSResolver` | Name resolution |
| `JNSRegistrar` | Domain registration |

## Deployment

### Localnet

```bash
cd packages/contracts
forge script script/DeployLocalnet.s.sol \
  --rpc-url http://localhost:9545 \
  --broadcast
```

### Testnet

```bash
PRIVATE_KEY=$DEPLOYER_KEY forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --broadcast --verify
```

### Mainnet

```bash
# Requires Safe multi-sig
bun run scripts/deploy-jeju-token.ts --network mainnet --safe 0x...
```

## Development

```bash
# Build
forge build

# Test
forge test

# Test specific contract
forge test --match-contract JejuToken

# Gas report
forge test --gas-report
```

## Contract Addresses

### Mainnet (420691)

| Contract | Address |
|----------|---------|
| JejuToken | `0x...` |
| IdentityRegistry | `0x...` |
| TokenRegistry | `0x...` |
| MultiTokenPaymaster | `0x...` |

### Testnet (420690)

| Contract | Address |
|----------|---------|
| JejuToken | `0x...` |
| IdentityRegistry | `0x...` |
| TokenRegistry | `0x...` |
| MultiTokenPaymaster | `0x...` |

See [Contract Addresses](/reference/addresses) for full list.

## Security

- Production deployments use Safe multi-sig ownership
- BanManager integration for network-wide moderation
- Upgradeable via OpenZeppelin proxy pattern
- Regular security audits

## Related

- [Token Contracts](/contracts/tokens) - Token details
- [OIF Contracts](/contracts/oif) - Intent framework
- [EIL Contracts](/contracts/eil) - Instant bridging
- [Deploy Contracts](/deployment/contracts) - Deployment guide

---

<details>
<summary>📋 Copy as Context</summary>

```
@jejunetwork/contracts - Smart Contract ABIs and Addresses

Installation: bun add @jejunetwork/contracts

Usage:
import { getContractAddresses, JejuTokenAbi } from '@jejunetwork/contracts';
const addresses = getContractAddresses(420691);

Categories:
- Tokens: JejuToken, TokenRegistry, ERC20Factory
- Identity: IdentityRegistry, ReputationRegistry, ValidationRegistry
- Payments: MultiTokenPaymaster, SponsoredPaymaster, PaymasterFactory
- OIF: InputSettler, OutputSettler, SolverRegistry, OracleAdapter
- EIL: L1StakeManager, CrossChainPaymaster, LiquidityVault
- DeFi: Bazaar, LiquidityAggregator, BondingCurve
- Governance: Council, GovernanceTimelock, DAORegistry
- Moderation: BanManager, ModerationMarketplace, EvidenceRegistry
- JNS: JNSRegistry, JNSResolver, JNSRegistrar

Deployment:
forge script script/DeployTestnet.s.sol --rpc-url $RPC --broadcast --verify

Development:
forge build
forge test
forge test --match-contract JejuToken
```

</details>

