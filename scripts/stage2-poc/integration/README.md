# Stage 2 Integration Components

Integration adapters that connect Stage 2 contracts with OP Stack components.

## Components

### ConsensusAdapter
- Interfaces Tendermint consensus with OP Stack
- Loads sequencers from SequencerRegistry
- Selects sequencers using weighted selection
- Records block proposals

**Usage**: `bun run scripts/stage2-poc/run-consensus.ts`

### ThresholdSigner
- Implements MPC threshold signing for batches
- Requires 2/3+ sequencers to sign
- Combines signature shares

**Usage**: Integrated into op-batcher (when modified)

### ChallengerAdapter
- Permissionless fraud proof challenger
- Monitors L2OutputOracle for invalid outputs
- Creates dispute games automatically
- No allowlist required

**Usage**: `bun run scripts/stage2-poc/run-challenger.ts`

## Integration Points

These adapters show how to integrate Stage 2 contracts with OP Stack:

1. **op-node**: Use ConsensusAdapter to replace single sequencer
2. **op-batcher**: Use ThresholdSigner for batch signing
3. **op-challenger**: Use ChallengerAdapter to remove allowlist

## Production Notes

In production, these would be:
- Integrated directly into OP Stack code (Go)
- Use proper MPC libraries (tss-lib, go-tss)
- Use actual Tendermint consensus
- Properly verify fraud proofs

For POC, these are simplified TypeScript implementations.

