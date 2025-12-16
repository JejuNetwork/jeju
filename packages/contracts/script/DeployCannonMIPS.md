# Deploying Real Cannon MIPS for Stage 2 Compliance

## The Problem

The current Stage 2 deployment uses **placeholder addresses** for MIPS and PreimageOracle.
This means the CannonProver is in **TEST MODE** and cannot verify real fraud proofs.

## What's Required for True Stage 2

1. **MIPS.sol** - The MIPS64 virtual machine that executes disputed instructions
2. **PreimageOracle.sol** - Storage for preimages needed during MIPS execution

Both must be deployed from Optimism's official `contracts-bedrock` package.

## Option 1: Use Optimism's Deployed Contracts (Recommended for Base)

If deploying on Base (which is an OP Stack chain), you can use Optimism's already-deployed contracts:

```bash
# Base Mainnet (chainId: 8453)
export MIPS_ADDRESS=0x16e83cE5Ce29BF90AD9Da06D2fE6a15d5f344ce4
export PREIMAGE_ORACLE_ADDRESS=0x9c065e11870B891D214Bc2Da7EF1f9DDFA1BE277

# Base Sepolia (chainId: 84532)
export MIPS_ADDRESS=0x47B0E34C1054009e696BaBAAc5b2e9dcF3A54Ad5
export PREIMAGE_ORACLE_ADDRESS=0xD97D3C17d98dCD978b2b9b2a5F5d5c5b4E5E4A5A
```

Then re-run deployment:
```bash
forge script script/DeployDecentralization.s.sol --broadcast
```

## Option 2: Deploy Fresh MIPS Contracts

If you need to deploy your own MIPS contracts (custom chain):

### Prerequisites
- Clone Optimism monorepo: `git clone https://github.com/ethereum-optimism/optimism`
- Requires solc 0.8.15 (different from our 0.8.26)

### Steps

```bash
# 1. Clone Optimism
cd vendor
git clone --depth 1 https://github.com/ethereum-optimism/optimism optimism-cannon

# 2. Install dependencies
cd optimism-cannon/packages/contracts-bedrock
pnpm install

# 3. Deploy PreimageOracle first
forge create src/cannon/PreimageOracle.sol:PreimageOracle \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url $RPC_URL \
  --constructor-args 0 0

# 4. Deploy MIPS with PreimageOracle address
forge create src/cannon/MIPS.sol:MIPS \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url $RPC_URL \
  --constructor-args $PREIMAGE_ORACLE_ADDRESS

# 5. Note the addresses and export
export MIPS_ADDRESS=<deployed address>
export PREIMAGE_ORACLE_ADDRESS=<deployed address>
```

## Verification

After deployment with real MIPS addresses, verify:

```bash
# CannonProver should NOT be in test mode
cast call $CANNON_PROVER_ADDRESS "isTestMode()" --rpc-url $RPC_URL
# Should return: false (0x0)

# MIPS should have code
cast code $MIPS_ADDRESS --rpc-url $RPC_URL
# Should return: 0x6080... (bytecode)
```

## Absolute Prestate

For the genesis MIPS state hash, use Optimism's official value:
```bash
# Get from Optimism's deployment
export ABSOLUTE_PRESTATE=0x03925193e3e89f87835bbdf3a813f60b2aa818a36bbe71cd5d8fd7e79f5e8afe
```

## Summary

| Component | Current Status | Required for Stage 2 |
|-----------|---------------|---------------------|
| MIPS.sol | Placeholder | Real deployment |
| PreimageOracle.sol | Placeholder | Real deployment |
| CannonProver | Test mode | Connected to real MIPS |
| Legacy Prover | Available | DISABLED in production |

