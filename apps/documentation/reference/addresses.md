# Contract Addresses

> **TL;DR:** Use `getContract('category', 'name')` from `@jejunetwork/config`. Key addresses: EntryPoint v0.7 at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, WETH at `0x4200000000000000000000000000000000000006`.

## Usage

```typescript
import { getContract, getConfig } from '@jejunetwork/config';

// Get address for current network (based on JEJU_NETWORK env var)
const identityRegistry = getContract('registry', 'identity');
const solverRegistry = getContract('oif', 'solverRegistry');
const paymaster = getContract('paymaster', 'multiToken');

// Get network config
const config = getConfig();
console.log(config.chainId);  // 1337, 420690, or 420691
console.log(config.rpcUrl);   // Network-specific RPC
```

## Constants (All Networks)

```typescript
const CONSTANTS = {
  ENTRY_POINT_V6: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  ENTRY_POINT_V7: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  L2_MESSENGER: '0x4200000000000000000000000000000000000007',
  L2_STANDARD_BRIDGE: '0x4200000000000000000000000000000000000010',
  WETH: '0x4200000000000000000000000000000000000006',
} as const;
```

## Testnet (Chain ID: 420690)

### Tokens
```typescript
const TESTNET_TOKENS = {
  JEJU: '0x7af64e6aE21076DE21EFe71F243A75664a17C34b',
  USDC: '0x953F6516E5d2864cE7f13186B45dE418EA665EB2',
  WETH: '0x4200000000000000000000000000000000000006',
} as const;
```

### OIF (Open Intents Framework)
```typescript
const TESTNET_OIF = {
  SOLVER_REGISTRY: '0x08cAa161780d195E0799b73b318da5D175b85313',
  INPUT_SETTLER: '0xD28752E9bBC29DDc14DA83dD673a36A5A19e91B1',
  OUTPUT_SETTLER: '0x198D8D23B57C3F490Bc78dbe66D9c23B27A289ca',
  ORACLE_ADAPTER: '0xe1f87369beED68C52003372Fe33Db8A245317B6E',
} as const;
```

### EIL (Bridge)
```typescript
const TESTNET_EIL = {
  // On Sepolia (L1)
  L1_STAKE_MANAGER: '0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C',
} as const;
```

## External Chains (Testnet)

### Sepolia (Chain ID: 11155111)
```typescript
const SEPOLIA = {
  RPC: 'https://ethereum-sepolia-rpc.publicnode.com',
  SOLVER_REGISTRY: '0x08cAa161780d195E0799b73b318da5D175b85313',
  INPUT_SETTLER: '0xD28752E9bBC29DDc14DA83dD673a36A5A19e91B1',
  OUTPUT_SETTLER: '0x198D8D23B57C3F490Bc78dbe66D9c23B27A289ca',
  ORACLE_ADAPTER: '0xe1f87369beED68C52003372Fe33Db8A245317B6E',
  L1_STAKE_MANAGER: '0xBf871db95b89Fde7D13b4FAA8b8E47aB5F00C29C',
} as const;
```

### Base Sepolia (Chain ID: 84532)
```typescript
const BASE_SEPOLIA = {
  RPC: 'https://sepolia.base.org',
  SOLVER_REGISTRY: '0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de',
  INPUT_SETTLER: '0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75',
  OUTPUT_SETTLER: '0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5',
  ORACLE_ADAPTER: '0xE30218678a940d1553b285B0eB5C5364BBF70ed9',
  USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  ELIZA_OS: '0x7af64e6aE21076DE21EFe71F243A75664a17C34b',
} as const;
```

### Arbitrum Sepolia (Chain ID: 421614)
```typescript
const ARBITRUM_SEPOLIA = {
  RPC: 'https://sepolia-rollup.arbitrum.io/rpc',
  USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
} as const;
```

### Optimism Sepolia (Chain ID: 11155420)
```typescript
const OPTIMISM_SEPOLIA = {
  RPC: 'https://sepolia.optimism.io',
  USDC: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
} as const;
```

## Mainnet (Chain ID: 420691)

```typescript
const MAINNET = {
  WETH: '0x4200000000000000000000000000000000000006',
  // Other addresses in packages/config/contracts.json after launch
} as const;
```

## External Chains (Mainnet)

```typescript
const EXTERNAL_MAINNET = {
  ETHEREUM: { chainId: 1, rpc: 'https://eth.llamarpc.com' },
  BASE: { chainId: 8453, rpc: 'https://mainnet.base.org', USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  ARBITRUM: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc' },
  OPTIMISM: { chainId: 10, rpc: 'https://mainnet.optimism.io' },
} as const;
```

## Full Config File Location

All addresses stored in `packages/config/contracts.json`:

```json
{
  "testnet": {
    "tokens": { "jeju": "0x...", "usdc": "0x..." },
    "oif": { "solverRegistry": "0x...", "inputSettler": "0x..." },
    "registry": { "identity": "0x..." },
    "paymaster": { "multiToken": "0x...", "factory": "0x..." }
  }
}
```
