# Rollup Configuration Files

Configuration files for Jeju OP Stack rollup.

## Files

### `mainnet.json`
Rollup configuration for Jeju mainnet (Chain ID: 420691)
- Settlement layer: Base Mainnet (Chain ID: 8453)
- Block time: 2 seconds
- Channel timeout: 5 minutes

### `testnet.json`
Rollup configuration for Jeju testnet (Chain ID: 420690)
- Settlement layer: Base Sepolia (Chain ID: 84532)
- Block time: 2 seconds
- Used for development and testing

## Usage

These files are used by:
- `op-node` - Derives L3 blocks from L2 batches
- `op-batcher` - Batches L3 transactions to L2
- `op-proposer` - Proposes state roots to L2
- Node operators - Configures their nodes

### For Node Operators

Download during installation:
```bash
curl -fsSL https://raw.githubusercontent.com/jeju-l3/config/main/rollup-mainnet.json \
  -o ~/.jeju/config/rollup.json
```

Or automatically via install script:
```bash
curl -fsSL https://raw.githubusercontent.com/jeju-l3/jeju/main/scripts/install-node.sh | bash
```

### For Infrastructure

Used in docker-compose.yml:
```yaml
op-node:
  volumes:
    - ./config/rollup.json:/config/rollup.json:ro
  command:
    - --rollup.config=/config/rollup.json
```

## Important Fields

### Chain IDs
- `l1_chain_id`: Settlement layer (Base)
- `l2_chain_id`: Jeju

### Timing
- `block_time`: Block production interval (2 seconds)
- `max_sequencer_drift`: Max time sequencer can drift (10 minutes)
- `channel_timeout`: How long to wait for batch (5 minutes)

### Addresses (Post-Deployment)
- `deposit_contract_address`: OptimismPortal on Base
- `l1_system_config_address`: SystemConfig on Base
- `batch_inbox_address`: Where batches are sent on Base

## Updating Configuration

⚠️  **WARNING:** Changing these values requires coordinated upgrade!

All nodes must update simultaneously:
1. Update config files
2. Coordinate upgrade time
3. All operators update configs
4. Restart nodes simultaneously

## References

- [OP Stack Rollup Config Spec](https://github.com/ethereum-optimism/optimism/blob/develop/specs/rollup-node.md)
- [Jeju Deployment Guide](../../documentation/deployment/overview.md)

