# Stage 2 Integration Components

Adapters connecting Stage 2 contracts with OP Stack components.

## Components

### ConsensusAdapter
- Interfaces Tendermint consensus with OP Stack
- Loads sequencers from SequencerRegistry
- Selects sequencers using weighted selection

**Usage**: `bun run scripts/stage2-poc/run-consensus.ts`

### ThresholdSigner
- Threshold signing for batches (2/3+ required)
- Combines signature shares

**Usage**: Integrated into op-batcher

## Related Scripts

### Challenger Service
Self-contained permissionless challenger that monitors outputs and creates disputes.

**Usage**: `CHALLENGER_PRIVATE_KEY=... bun run scripts/stage2-poc/run-challenger.ts`

## Integration Points

1. **op-node**: Use ConsensusAdapter to replace single sequencer
2. **op-batcher**: Use ThresholdSigner for batch signing
3. **op-challenger**: Run challenger service (permissionless)

## Production Notes

In production:
- Integrate directly into OP Stack code (Go)
- Use proper MPC libraries (tss-lib, go-tss)
- Use actual Tendermint consensus
- Properly verify fraud proofs

