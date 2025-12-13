# Contract Addresses

All deployed contract addresses by network.

## How to Access

```typescript
import { getContract } from '@jejunetwork/config';

// Get address for current network
const solver = getContract('oif', 'solverRegistry');
const identity = getContract('registry', 'identity');
```

## Constants (All Networks)

EntryPoint v0.6 is deployed at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`. EntryPoint v0.7 is at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. L2 Messenger is at `0x4200000000000000000000000000000000000007`. L2 Standard Bridge is at `0x4200000000000000000000000000000000000010`. WETH is at `0x4200000000000000000000000000000000000006`.

## Localnet (Chain ID: 1337)

Deployed on `bun run dev`. Check `packages/contracts/deployments/` for latest.

## Testnet (Chain ID: 420690)

### Tokens

elizaOS is at `0x7af64e6aE21076DE21EFe71F243A75664a17C34b`. USDC is at `0x953F6516E5d2864cE7f13186B45dE418EA665EB2`. WETH is at `0x4200000000000000000000000000000000000006`.

### EIL (Cross-Chain)

L1StakeManager on Sepolia is at `0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C`.

## External Chains (Testnet)

### Sepolia (Chain ID: 11155111)

SolverRegistry is at `0x08cAa161780d195E0799b73b318da5D175b85313`. InputSettler is at `0xD28752E9bBC29DDc14DA83dD673a36A5A19e91B1`. OutputSettler is at `0x198D8D23B57C3F490Bc78dbe66D9c23B27A289ca`. OracleAdapter is at `0xe1f87369beED68C52003372Fe33Db8A245317B6E`. L1StakeManager is at `0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C`.

### Base Sepolia (Chain ID: 84532)

SolverRegistry is at `0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de`. InputSettler is at `0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75`. OutputSettler is at `0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5`. OracleAdapter is at `0xE30218678a940d1553b285B0eB5C5364BBF70ed9`. USDC is at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. elizaOS is at `0x7af64e6aE21076DE21EFe71F243A75664a17C34b`.

### Arbitrum Sepolia (Chain ID: 421614)

USDC is at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`.

### Optimism Sepolia (Chain ID: 11155420)

USDC is at `0x5fd84259d66Cd46123540766Be93DFE6D43130D7`.

## Mainnet (Chain ID: 420691)

### Tokens

WETH is at `0x4200000000000000000000000000000000000006`.

*Other mainnet addresses: see `packages/config/contracts.json`*

## External Chains (Mainnet)

### Ethereum (Chain ID: 1)

RPC: https://eth.llamarpc.com

### Base (Chain ID: 8453)

USDC is at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

RPC: https://mainnet.base.org

### Arbitrum (Chain ID: 42161)

RPC: https://arb1.arbitrum.io/rpc

### Optimism (Chain ID: 10)

RPC: https://mainnet.optimism.io

## Updating Addresses

After deployment, update `packages/config/contracts.json`:

```bash
# Edit file
vim packages/config/contracts.json

# Rebuild
cd packages/config && bun run build

# Commit
git add packages/config/contracts.json
git commit -m "chore: update contract addresses"
```

## Verifying Addresses

Check on-chain:

```bash
# Get code at address
cast code $ADDRESS --rpc-url $RPC

# Get storage
cast storage $ADDRESS 0 --rpc-url $RPC
```

Check in explorer:
- Testnet: https://testnet-explorer.jeju.network
- Mainnet: https://explorer.jeju.network

