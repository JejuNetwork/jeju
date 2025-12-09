# Architecture

## Stack

```
Ethereum (settlement, finality)
    ↑
Jeju (execution, 200ms Flashblocks)
    ↓
EigenDA (data availability)
```

## Components

| Component | Role |
|-----------|------|
| Reth | Execution client (Rust) |
| OP-Node | Consensus + Flashblocks |
| op-batcher | Batches txs to EigenDA/Ethereum |
| op-proposer | Posts state roots to Ethereum |
| op-challenger | Fraud proofs |

## Block Times

| Stage | Time |
|-------|------|
| Flashblock | 200ms |
| Full block | 2s |
| Batch | ~10 min |
| State root | ~1 hr |
| Challenge | 7 days |

## Transaction Flow

```
User tx → Sequencer (200ms) → Block (2s) → Batch → State root → Ethereum
```

## Fees

```
Total = Execution Fee + L1 Data Fee

Execution = Gas × Gas Price → Sequencer
L1 Data = Bytes × Ethereum Gas Price → Settlement
```

## Security

- Fraud proofs via op-challenger
- 7-day challenge period on Ethereum
- EigenDA + calldata fallback for data availability
- Trust: Ethereum + 1 honest challenger
