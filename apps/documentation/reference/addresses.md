# Contract Addresses

All deployed contract addresses by network.

## Usage in Code

```typescript
import { getContract } from '@jejunetwork/config';

const identity = getContract('registry', 'identity');
const solver = getContract('oif', 'solverRegistry');
```

## Constants (All Networks)

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| L2 Messenger | `0x4200000000000000000000000000000000000007` |
| L2 Standard Bridge | `0x4200000000000000000000000000000000000010` |
| WETH | `0x4200000000000000000000000000000000000006` |

## Localnet (Chain ID: 1337)

Addresses are generated on each `bun run dev`. Check `packages/contracts/deployments/localnet.json` for current addresses.

## Testnet (Chain ID: 420690)

### Tokens

| Token | Address |
|-------|---------|
| JEJU | `0x7af64e6aE21076DE21EFe71F243A75664a17C34b` |
| USDC | `0x953F6516E5d2864cE7f13186B45dE418EA665EB2` |
| WETH | `0x4200000000000000000000000000000000000006` |

### Identity

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x...` |
| BanManager | `0x...` |

### Paymasters

| Contract | Address |
|----------|---------|
| MultiTokenPaymaster | `0x...` |
| PaymasterFactory | `0x...` |
| TokenRegistry | `0x...` |

### OIF (Open Intents)

| Contract | Address |
|----------|---------|
| SolverRegistry | `0x08cAa161780d195E0799b73b318da5D175b85313` |
| InputSettler | `0xD28752E9bBC29DDc14DA83dD673a36A5A19e91B1` |
| OutputSettler | `0x198D8D23B57C3F490Bc78dbe66D9c23B27A289ca` |
| OracleAdapter | `0xe1f87369beED68C52003372Fe33Db8A245317B6E` |

### EIL (Bridge)

| Contract | Chain | Address |
|----------|-------|---------|
| L1StakeManager | Sepolia | `0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C` |
| CrossChainPaymaster | Jeju Testnet | `0x...` |

## External Chains (Testnet)

### Sepolia (Chain ID: 11155111)

| Contract | Address |
|----------|---------|
| SolverRegistry | `0x08cAa161780d195E0799b73b318da5D175b85313` |
| InputSettler | `0xD28752E9bBC29DDc14DA83dD673a36A5A19e91B1` |
| OutputSettler | `0x198D8D23B57C3F490Bc78dbe66D9c23B27A289ca` |
| OracleAdapter | `0xe1f87369beED68C52003372Fe33Db8A245317B6E` |
| L1StakeManager | `0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C` |

### Base Sepolia (Chain ID: 84532)

| Contract | Address |
|----------|---------|
| SolverRegistry | `0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de` |
| InputSettler | `0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75` |
| OutputSettler | `0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5` |
| OracleAdapter | `0xE30218678a940d1553b285B0eB5C5364BBF70ed9` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| elizaOS | `0x7af64e6aE21076DE21EFe71F243A75664a17C34b` |

### Arbitrum Sepolia (Chain ID: 421614)

| Token | Address |
|-------|---------|
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

### Optimism Sepolia (Chain ID: 11155420)

| Token | Address |
|-------|---------|
| USDC | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |

## Mainnet (Chain ID: 420691)

### Tokens

| Token | Address |
|-------|---------|
| WETH | `0x4200000000000000000000000000000000000006` |

*Full mainnet addresses available after launch in `packages/config/contracts.json`*

## External Chains (Mainnet)

### Base (Chain ID: 8453)

| Token | Address |
|-------|---------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Updating Addresses

After deployment, update config and rebuild:

```bash
vim packages/config/contracts.json
cd packages/config && bun run build
git commit -am "chore: update contract addresses"
```

## Verifying Addresses

```bash
# Check code at address
cast code $ADDRESS --rpc-url $RPC

# Check in explorer
open https://testnet-explorer.jeju.network/address/$ADDRESS
```
