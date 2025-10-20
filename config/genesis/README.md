# Genesis Configuration Files

Genesis state for Jeju blockchain.

## Files

### `mainnet.json`
Genesis configuration for Jeju mainnet
- Chain ID: 420691
- Pre-deployed contracts (WETH, Bridge, etc.)
- Initial state and allocations

### `testnet.json` 
Genesis configuration for Jeju testnet
- Chain ID: 420690
- Same predeploys as mainnet
- Test allocations

## Usage

### For Infrastructure Team

Generated via `op-node genesis l2`:
```bash
op-node genesis l2 \
  --deploy-config deploy-config.json \
  --l1-deployments l1-deployments.json \
  --outfile.l2 genesis.json \
  --outfile.rollup rollup.json
```

### For Node Operators

Not typically needed by operators (rollup.json is sufficient).

Used only for:
- Bootstrapping new sequencer nodes
- Debugging genesis state
- Network recovery scenarios

## Important Sections

### `config`
EVM chain configuration:
- Fork blocks (Homestead, Berlin, London, etc.)
- Optimism-specific parameters
- EIP-1559 settings

### `alloc`
Pre-deployed contracts at specific addresses:
- `0x4200000000000000000000000000000000000006` - WETH
- `0x4200000000000000000000000000000000000010` - L2StandardBridge
- etc.

### `genesis`
Genesis block parameters:
- Timestamp
- Gas limit
- Base fee
- Difficulty (always 0 for PoS)

## Predeploy Addresses

Standard OP Stack predeploys:

```
WETH:                    0x4200000000000000000000000000000000000006
L2CrossDomainMessenger:  0x4200000000000000000000000000000000000007
L2StandardBridge:        0x4200000000000000000000000000000000000010
L2ToL1MessagePasser:     0x4200000000000000000000000000000000000016
GasPriceOracle:          0x420000000000000000000000000000000000000F
L1Block:                 0x4200000000000000000000000000000000000015
SequencerFeeVault:       0x4200000000000000000000000000000000000011
BaseFeeVault:            0x4200000000000000000000000000000000000019
L1FeeVault:              0x420000000000000000000000000000000000001A
```

## Modifying Genesis

⚠️  **WARNING:** Never modify genesis.json after chain launch!

Changes to genesis create a new incompatible chain. Only modify:
- Before initial launch
- For testnets (can reset)
- For private devnets

## References

- [OP Stack Genesis Spec](https://github.com/ethereum-optimism/optimism/blob/develop/specs/glossary.md#l2-genesis-block)
- [Predeploy Contracts](https://github.com/ethereum-optimism/optimism/blob/develop/specs/predeploys.md)

