# Testnet Deployment Guide

## Prerequisites

1. **Deployer wallet** with ETH on Base Sepolia
2. **Environment variables** set (see below)

## Quick Start

```bash
cd packages/contracts

# Set required env vars
export DEPLOYER_PRIVATE_KEY=0x...
export BASESCAN_API_KEY=...
export ETHERSCAN_API_KEY=...

# Use existing Base Sepolia IdentityRegistry
export IDENTITY_REGISTRY=0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd

# Deploy Stage 2 contracts
forge script script/DeployDecentralization.s.sol:DeployDecentralization \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --verify
```

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Deployer wallet private key |

### Optional (auto-detected for Base Sepolia)
| Variable | Description | Default |
|----------|-------------|---------|
| `MIPS_ADDRESS` | Optimism MIPS contract | `0x47B0E34C1054009e696BaBaAc5b2E9DCF3a54ad5` |
| `PREIMAGE_ORACLE_ADDRESS` | PreimageOracle contract | `0xd97d3c17D98dcD978B2b9B2A5f5D5c5b4E5e4a5a` |
| `IDENTITY_REGISTRY` | Existing IdentityRegistry | Deploys new if not set |
| `REPUTATION_REGISTRY` | Existing ReputationRegistry | Deploys new if not set |
| `JEJU_TOKEN` | JEJU token address | Deploys mock if not set |
| `TREASURY` | Treasury address | Defaults to deployer |
| `GOVERNANCE` | Governance address | Defaults to deployer |
| `SECURITY_COUNCIL` | Safe multisig address | Defaults to deployer |
| `SIGNER_THRESHOLD` | Batch signing threshold | `2` |

## Existing Base Sepolia Contracts

Use these if already deployed:

```bash
# ERC-8004 Identity
export IDENTITY_REGISTRY=0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd

# OIF
export SOLVER_REGISTRY=0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de
export INPUT_SETTLER=0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75
export OUTPUT_SETTLER=0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5
```

## Deployed Contracts (After Running)

After deployment, update `deployments/addresses.json` with:
- `SequencerRegistry`
- `ThresholdBatchSubmitter`
- `GovernanceTimelock`
- `DisputeGameFactory`
- `CannonProver`
- `ForcedInclusion`
- `L2OutputOracleAdapter`
- `OptimismPortalAdapter`

## Security Council Setup

For production, create a Gnosis Safe at [safe.global](https://app.safe.global/):

1. Connect to Base Sepolia
2. Create new Safe with 3-of-5 threshold
3. Add 5 independent owner addresses
4. Copy Safe address
5. Set `SECURITY_COUNCIL=<safe-address>`

For testing, the deployer address is used as Security Council.

## Verification

After deployment, verify contracts on Basescan:

```bash
forge verify-contract <address> <Contract> \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY
```

## Stage 2 Compliance Checklist

| Requirement | Status |
|-------------|--------|
| 7-day dispute window | ✅ |
| 30-day upgrade timelock | ✅ |
| 7-day emergency minimum | ✅ |
| Forced inclusion | ✅ |
| Security Council Safe | ⚠️ Create on safe.global |
| MIPS fraud proofs | ✅ (Base Sepolia defaults) |

## Troubleshooting

### "Failed to resolve env var"
Make sure all required env vars are exported in the same shell.

### "Insufficient funds"
Get Base Sepolia ETH from a faucet.

### "Contract verification failed"
Wait 30 seconds after deployment, then retry verification.

