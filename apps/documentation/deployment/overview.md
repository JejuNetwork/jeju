# Deployment

## Options

| Environment | Time | Use Case |
|-------------|------|----------|
| [Localnet](/getting-started/quick-start) | 10 min | Development |
| [Testnet](./testnet-checklist) | 2-4 hrs | Public testing |
| [Mainnet](./mainnet-checklist) | 1-2 days | Production |

## Components

```
AWS EKS
├── op-node (consensus)
├── reth (execution)
├── op-batcher
├── op-proposer
└── monitoring

Base (settlement layer)
├── OptimismPortal
├── L2OutputOracle
├── L1StandardBridge
└── SystemConfig

EigenDA (data availability)
```

## Process

1. **Infrastructure** (Terraform): VPC, EKS, RDS
2. **Contracts** (Foundry): Deploy L1 contracts to Ethereum
3. **Services** (Helm): Deploy OP Stack
4. **Validation**: Test blocks, deposits, withdrawals

## Before Mainnet

- [ ] Full audit ($50k-200k)
- [ ] Bug bounty live
- [ ] Multisig configured
- [ ] Emergency runbooks
- [ ] 24/7 on-call team
- [ ] Testnet stable 4+ weeks
