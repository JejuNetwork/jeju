# Contract Addresses

## Jeju Predeploys

Standard OP-Stack addresses:

```typescript
// Bridge & Messaging
CrossDomainMessenger:   '0x4200000000000000000000000000000000000007'
StandardBridge:         '0x4200000000000000000000000000000000000010'
ERC721Bridge:           '0x4200000000000000000000000000000000000014'
ToL1MessagePasser:      '0x4200000000000000000000000000000000000016'

// System
GasPriceOracle:         '0x420000000000000000000000000000000000000F'
L1Block:                '0x4200000000000000000000000000000000000015'
SequencerFeeVault:      '0x4200000000000000000000000000000000000011'
BaseFeeVault:           '0x4200000000000000000000000000000000000019'
L1FeeVault:             '0x420000000000000000000000000000000000001A'

// Utilities
WETH:                   '0x4200000000000000000000000000000000000006'
OptimismMintableERC20Factory: '0x4200000000000000000000000000000000000012'
OptimismMintableERC721Factory: '0x4200000000000000000000000000000000000017'
Multicall3:             '0xcA11bde05977b3631167028862bE2a173976CA11'
```

## Ethereum Contracts

Deployed addresses saved to `packages/contracts/deployments/{network}/` after running deployment scripts.

## Infrastructure

```typescript
// ERC-4337
EntryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'  // v0.6 standard
```

## Usage

### Ethers.js

```typescript
const provider = new ethers.JsonRpcProvider('https://rpc.jeju.network');
const bridge = new ethers.Contract(
  '0x4200000000000000000000000000000000000010',
  StandardBridgeABI,
  provider
);
```

### Viem

```typescript
const client = createPublicClient({ chain: jeju, transport: http() });
const data = await client.readContract({
  address: '0x4200000000000000000000000000000000000010',
  abi: StandardBridgeABI,
  functionName: 'paused',
});
```

## ABIs

Available at `packages/contracts/out/` or download from block explorer.
