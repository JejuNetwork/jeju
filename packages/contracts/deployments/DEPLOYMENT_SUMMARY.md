# Deployment Summary

**Date**: December 9, 2024  
**Deployer**: `0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064`

## Base Sepolia (Chain ID: 84532) ✅ DEPLOYED

### Tokens
| Contract | Address | Status |
|----------|---------|--------|
| MockJejuUSDC | `0x953F6516E5d2864cE7f13186B45dE418EA665EB2` | ✅ Deployed |
| ElizaOSToken | `0x7af64e6aE21076DE21EFe71F243A75664a17C34b` | ✅ Deployed |

### ERC-8004 Registry
| Contract | Address | Status |
|----------|---------|--------|
| IdentityRegistry | `0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd` | ✅ Deployed |

**Eliza Cloud Agent**: Registered as Agent ID #1

### OIF (Open Intents Framework)
| Contract | Address | Status |
|----------|---------|--------|
| SolverRegistry | `0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de` | ✅ Deployed |
| SimpleOracle | `0xE30218678a940d1553b285B0eB5C5364BBF70ed9` | ✅ Deployed |
| InputSettler | `0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75` | ✅ Deployed |
| OutputSettler | `0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5` | ✅ Deployed |

**Oracle Owner/Attester**: `0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064`

## Sepolia (Chain ID: 11155111) ⏳ PENDING

**Status**: Need testnet ETH to deploy  
**Wallet**: `0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064` (0 ETH)

**Faucets**:
- https://sepoliafaucet.com
- https://sepolia-faucet.pk910.de
- https://www.alchemy.com/faucets/ethereum-sepolia

## Jeju Testnet (Chain ID: 420690) ⏳ PENDING

**Status**: RPC not live yet (`testnet-rpc.jeju.network`)  
**When Live**: Deploy same contracts as Base Sepolia

## How Bridgeless OIF Works

```
┌────────────────────────────────────────────────────────────┐
│                    OIF INTENT FLOW                          │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  USER on Base Sepolia:                                      │
│  "I want 100 USDC on Jeju Testnet"                          │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────┐                   │
│  │  InputSettler.createIntent()        │                   │
│  │  - Locks 100 USDC on Base Sepolia   │                   │
│  │  - Emits IntentCreated event        │                   │
│  └─────────────────────────────────────┘                   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────┐                   │
│  │  SOLVER sees intent via Aggregator  │                   │
│  │  - Has liquidity on BOTH chains     │                   │
│  │  - Chooses to fill                  │                   │
│  └─────────────────────────────────────┘                   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────┐                   │
│  │  OutputSettler.fill() on Jeju       │ ◄── INSTANT       │
│  │  - Transfers 100 USDC to user       │                   │
│  │  - Emits OrderFilled event          │                   │
│  └─────────────────────────────────────┘                   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────┐                   │
│  │  Oracle attests to the fill         │                   │
│  │  - SimpleOracle for testnet         │                   │
│  │  - SuperchainOracle for L1→L2       │                   │
│  └─────────────────────────────────────┘                   │
│                     │                                       │
│                     ▼                                       │
│  ┌─────────────────────────────────────┐                   │
│  │  Solver claims on Base Sepolia      │                   │
│  │  - Gets locked 100 USDC + fee       │                   │
│  └─────────────────────────────────────┘                   │
│                                                             │
│  ✅ NO BRIDGE - Solver provides liquidity                  │
│  ✅ INSTANT - User gets tokens immediately                 │
│  ✅ COMPETITIVE - Multiple solvers compete                 │
└────────────────────────────────────────────────────────────┘
```

## Test Commands

### Get Test USDC
```bash
# MockJejuUSDC has a faucet() function - gives 100M USDC
cast send 0x953F6516E5d2864cE7f13186B45dE418EA665EB2 "faucet()" \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY
```

### Check Agent Registration
```bash
cast call 0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd \
  "ownerOf(uint256)(address)" 1 \
  --rpc-url https://sepolia.base.org
# Returns: 0x5dB1268e424da5C26451e4a8B9C221e6DE3C3064
```

### View on Block Explorer
- [IdentityRegistry](https://sepolia.basescan.org/address/0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd)
- [SolverRegistry](https://sepolia.basescan.org/address/0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de)
- [MockJejuUSDC](https://sepolia.basescan.org/address/0x953F6516E5d2864cE7f13186B45dE418EA665EB2)
- [ElizaOSToken](https://sepolia.basescan.org/address/0x7af64e6aE21076DE21EFe71F243A75664a17C34b)

## Environment Variables

```bash
# Add to .env for cloud integration
JEJU_DEPLOYED=true
X402_NETWORK=base-sepolia

# Contract addresses
IDENTITY_REGISTRY_BASE_SEPOLIA=0x759D602d8D2E4F1ccCa12E955420cC19e64a68bd
USDC_BASE_SEPOLIA=0x953F6516E5d2864cE7f13186B45dE418EA665EB2
ELIZA_TOKEN_BASE_SEPOLIA=0x7af64e6aE21076DE21EFe71F243A75664a17C34b

# OIF contracts
OIF_SOLVER_REGISTRY=0xecfE47302D941c8ce5B0009C0ac2E6D6ee2A42de
OIF_ORACLE=0xE30218678a940d1553b285B0eB5C5364BBF70ed9
OIF_INPUT_SETTLER=0x9bb59d0329FcCEdD99f1753D20AF50347Ad2eB75
OIF_OUTPUT_SETTLER=0xf7ef3C6a54dA3E03A96D23864e5865E7e3EBEcF5
```

