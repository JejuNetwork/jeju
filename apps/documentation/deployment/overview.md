# Deployment Overview

Learn how to deploy your own Jeju instance on testnet or mainnet.

## Before You Start

::: warning Prerequisites Required
Deploying an L3 requires technical expertise, infrastructure, and capital. Make sure you understand the requirements before proceeding.
:::

### Who Should Deploy?

You should consider deploying your own Jeju instance if you:

- **Have a specific use case** requiring your own L3
- **Understand blockchain infrastructure** and operations
- **Have technical team** capable of 24/7 operations
- **Have capital** for infrastructure ($60k+ for mainnet)
- **Understand the economics** and have a revenue model

### Alternatives to Self-Deployment

If you just want to build on Jeju:

- **Use Public Jeju**: Build on the public Jeju testnet/mainnet
- **No deployment needed**: Just deploy your contracts
- **Lower cost**: No infrastructure to maintain
- **Easier**: Focus on your application

## Deployment Options

### Localnet (Development)

**Purpose**: Local development and testing

**Time**: 10 minutes  
**Requirements**: Docker, Kurtosis, Bun

**Guide**: [Quick Start](/getting-started/quick-start)

### Testnet (Staging)

**Purpose**: Public testing before mainnet

**Time**: 2-4 hours  
**Requirements**: AWS account, Base Sepolia ETH

**Guide**: [Testnet Deployment](./testnet)

### Mainnet (Production)

**Purpose**: Production deployment

**Time**: 1-2 days  
**Requirements**: Full audit, legal entity, 24/7 operations, significant infrastructure budget

**Guide**: [Mainnet Deployment](./mainnet)

## Architecture Components

### Infrastructure

You'll deploy these components:

```
┌─────────────────────────────────────────────────────┐
│ AWS EKS Cluster (Kubernetes)                         │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │  op-node     │  │  reth        │                │
│  │  (Consensus) │  │  (Execution) │                │
│  └──────────────┘  └──────────────┘                │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                │
│  │  op-batcher  │  │  op-proposer │                │
│  └──────────────┘  └──────────────┘                │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │  Monitoring (Prometheus/Grafana) │               │
│  └──────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Base (Settlement Layer)                           │
│  • L1 contracts (OptimismPortal, etc.)               │
│  • Receives your batches & state roots               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ EigenDA (Data Availability)                          │
│  • Stores transaction data                           │
│  • 90% cheaper than calldata                         │
└─────────────────────────────────────────────────────┘
```

### Smart Contracts

On Base (Jeju's settlement layer):
- `OptimismPortal` - Main entry point
- `L2OutputOracle` - Stores state roots
- `L1StandardBridge` - Asset bridging
- `L1CrossDomainMessenger` - Message passing
- `SystemConfig` - Configuration
- And more...

On Jeju (your L3):
- Predeploys (standard addresses)
- DeFi protocols (optional)
- Your application contracts

## Cost Breakdown

### Testnet

Primary costs:
- AWS EKS infrastructure
- RDS database
- Load balancers and networking
- Monitoring and observability

### Mainnet

Infrastructure costs include:
- AWS EKS cluster (production-grade)
- RDS with high availability
- Load balancers and CDN
- Monitoring and alerting
- Base settlement fees (L1 gas)
- EigenDA data availability

Initial capital requirements:
- ETH for contract deployment
- ETH for batcher operations
- ETH for proposer operations
- Emergency reserve funds

L3 architecture provides significant cost savings compared to L2 on Ethereum.

## Deployment Process

### Phase 1: Infrastructure (Terraform)

1. Set up AWS account
2. Configure S3/DynamoDB for state
3. Deploy VPC, EKS, RDS
4. Configure networking & security

**Time**: 1-2 hours  
**Tool**: Terraform

### Phase 2: Smart Contracts (Foundry)

1. Generate deployment keys
2. Fund deployer account
3. Deploy L1 contracts to Base
4. Verify on BaseScan
5. Initialize system

**Time**: 30-60 minutes  
**Tool**: Foundry

### Phase 3: Kubernetes Services (Helm)

1. Configure Helm values
2. Deploy op-node & reth
3. Deploy op-batcher
4. Deploy op-proposer
5. Deploy monitoring

**Time**: 30-60 minutes  
**Tool**: Helmfile

### Phase 4: Testing & Validation

1. Verify block production
2. Test deposits & withdrawals
3. Validate settlement on Base
4. Check monitoring & alerts
5. Perform load testing

**Time**: 2-4 hours

### Phase 5: Launch

1. Announce to community
2. Monitor closely (24/7)
3. Respond to issues quickly
4. Iterate and improve

**Ongoing**: 24/7 operations

## Key Decisions

### Sequencer Strategy

**Option 1: Single Sequencer (Recommended for start)**
- Simpler to operate
- Lower costs
- Centralized (acceptable initially)

**Option 2: Multiple Sequencers**
- More complex
- Higher costs
- Better decentralization

### Data Availability

**Option 1: EigenDA (Recommended)**
- 90% cost savings
- Requires integration
- Fallback to calldata

**Option 2: Calldata Only**
- Simpler
- More expensive ($7.5k/month vs $750/month)
- Always available

### Governance

**Option 1: Multisig (Recommended for start)**
- Simple and secure
- Fast decision making
- Centralized

**Option 2: DAO + Timelock**
- More decentralized
- Slower
- More complex

## Security Considerations

### Before Mainnet

Required:
- [ ] Full audit by reputable firm ($50k-200k)
- [ ] Bug bounty program live
- [ ] Multisig wallets configured
- [ ] Emergency procedures documented
- [ ] Insurance obtained ($25k-100k/year)
- [ ] Legal entity established
- [ ] Testnet stable for 4+ weeks
- [ ] 24/7 on-call team ready

### Operations

Ongoing:
- [ ] Monitor 24/7
- [ ] Rotate keys regularly
- [ ] Update software promptly
- [ ] Maintain documentation
- [ ] Train team on procedures
- [ ] Regular security reviews

## Legal & Compliance

### Required

- **Legal Entity**: LLC, Foundation, or DAO
- **Terms of Service**: User agreements
- **Privacy Policy**: Data handling
- **KYC/AML**: Depending on jurisdiction
- **Insurance**: Errors & omissions
- **Legal Counsel**: Ongoing advisory

**Cost**: $20k-100k initial + $50k+/year

### Jurisdiction Considerations

Popular options:
- **Cayman Islands**: Crypto-friendly
- **Switzerland**: Clear regulations
- **Wyoming**: DAO-friendly
- **Singapore**: Fintech hub

Consult legal counsel for your situation.

## Monitoring & Operations

### Metrics to Monitor

- **Block production rate**
- **Transaction throughput**
- **Gas prices**
- **Batch submission success**
- **State root posting**
- **Challenge events**
- **RPC availability**
- **Data availability (EigenDA)**
- **Infrastructure health**

### Alert Thresholds

Critical alerts:
- Sequencer down > 1 minute
- Batcher failing
- Proposer stuck
- RPC downtime
- Challenge detected

### On-Call Rotation

Minimum 3-person rotation:
- 24/7 coverage
- 15-minute SLA
- Escalation procedures
- Runbooks for common issues

See [Runbooks](./runbooks) for procedures.

## Support & Resources

### During Deployment

- **Discord**: [#deployment-support](https://discord.gg/jeju)
- **Email**: enterprise@jeju.network
- **Docs**: Full documentation
- **GitHub**: Example configurations

### After Launch

- **On-call Support**: Enterprise customers
- **Community**: Discord & forum
- **Updates**: Twitter & announcements
- **Security**: security@jeju.network

## Next Steps

Ready to deploy?

1. **[Prerequisites](./prerequisites)** - Check you have everything
2. **[Testnet Deployment](./testnet)** - Deploy to testnet first
3. **[Mainnet Deployment](./mainnet)** - Production deployment
4. **[Infrastructure](./infrastructure)** - Deep dive on AWS setup

Need help? [Contact us](mailto:enterprise@jeju.network) or [join Discord](https://discord.gg/jeju).

