# OP Stack Deploy Configurations

Configuration files for deploying Jeju using OP Stack tooling.

## Files

- `mainnet.json` - Production deployment config
- `testnet.json` - Testnet deployment config

## Usage

Used by `op-deployer` or `op-node genesis` command:

```bash
# Generate genesis and rollup config
op-node genesis l2 \
  --deploy-config config/deploy-configs/testnet.json \
  --l1-deployments deployments/base-sepolia/l1-contracts.json \
  --outfile.l2 genesis.json \
  --outfile.rollup rollup.json
```

## Key Parameters

### Chain Configuration
- `l1ChainID`: Base chain ID (8453 mainnet, 84532 sepolia)
- `l2ChainID`: Jeju chain ID (420691 mainnet, 420690 testnet)
- `l2BlockTime`: 2 seconds (fixed)

### Sequencer
- `p2pSequencerAddress`: Sequencer's P2P address
- `maxSequencerDrift`: Max clock drift (600s = 10 min)
- `sequencerWindowSize`: Max L1 blocks to wait (3600 = ~2 hours on Base)

### Batcher
- `batchInboxAddress`: Where batches are sent on Base
- `batchSenderAddress`: Batcher's address
- `channelTimeout`: Max time for batch channel (300s = 5 min)

### Proposer
- `l2OutputOracleProposer`: Proposer's address
- `l2OutputOracleChallenger`: Challenger's address
- `l2OutputOracleSubmissionInterval`: Blocks between proposals (120 = ~4 min)
- `finalizationPeriodSeconds`: Challenge period (7 days mainnet, 12s testnet)

### Fee Vaults
- `baseFeeVaultRecipient`: EIP-1559 base fee collector
- `l1FeeVaultRecipient`: L1 data fee collector
- `sequencerFeeVaultRecipient`: Priority fee collector

### Governance
- `finalSystemOwner`: Ultimate owner (should be multisig)
- `proxyAdminOwner`: Proxy admin owner (should be multisig)
- `enableGovernance`: Enable governance token

### Gas Configuration
- `gasPriceOracleOverhead`: Fixed overhead per transaction
- `gasPriceOracleScalar`: Multiplier for L1 data cost
- `l2GenesisBlockGasLimit`: Initial gas limit (30M)

## Before Deployment

Replace `0x0000...` addresses with actual addresses:

1. **Generate Wallets:**
   ```bash
   cast wallet new --label sequencer
   cast wallet new --label batcher
   cast wallet new --label proposer
   cast wallet new --label challenger
   ```

2. **Deploy Multisig:**
   - Use Gnosis Safe on Base
   - 3-of-5 or 4-of-7 recommended
   - Set as finalSystemOwner and proxyAdminOwner

3. **Fund Accounts:**
   - Sequencer: 1 ETH on Jeju (will earn fees)
   - Batcher: 10 ETH on Base (pays for batches)
   - Proposer: 5 ETH on Base (pays for state roots)
   - Challenger: 1 ETH on Base (permissionless)

4. **Update Config:**
   - Fill in all addresses
   - Double-check chain IDs
   - Review all parameters

## Validation

Before deploying:
```bash
# Validate JSON syntax
jq . config/deploy-configs/mainnet.json

# Check required fields
jq '.l2ChainID, .l1ChainID, .p2pSequencerAddress' config/deploy-configs/mainnet.json
```

## Post-Deployment

After running op-deployer:
1. Save L1 contract addresses
2. Update rollup.json references
3. Distribute genesis.json to all operators
4. Start sequencer, batcher, proposer
5. Operators can start nodes

## Security Notes

- **Never share private keys** in config files
- **Use multisig** for all owner roles
- **Test on testnet** before mainnet
- **Verify all addresses** before deployment
- **Keep backups** of all config files

## References

- [OP Stack Deploy Config](https://github.com/ethereum-optimism/optimism/blob/develop/op-chain-ops/genesis/config.go)
- [Jeju Deployment Guide](../../documentation/deployment/overview.md)
- [OP Stack Documentation](https://docs.optimism.io/)

