# Deployment Prerequisites

Requirements before deploying your own Jeju instance.

## Technical Requirements

### Hardware (Minimum)
- 8+ CPU cores
- 32+ GB RAM
- 500+ GB SSD storage
- 100+ Mbps network

### Software
- Docker & Docker Compose
- Kubernetes (for production)
- Helm 3+
- Foundry
- Bun or Node.js 18+

### Cloud (Recommended)
- AWS/GCP/Azure account
- Domain name for RPC endpoints
- SSL certificates (via cert-manager)

## Financial Requirements

### Testnet
- AWS infrastructure costs
- Base Sepolia gas for settlement
- Monitoring and observability
- Contingency buffer

### Mainnet
- Production-grade AWS infrastructure
- Base settlement costs (L1 gas fees)
- EigenDA data availability
- Monitoring and alerting
- Additional operational services

**Initial Capital Requirements**:
- ETH for contract deployment
- ETH for batcher operations (significant)
- ETH for proposer operations
- Emergency reserve fund

Mainnet deployment requires substantial infrastructure budget and ongoing operational costs.

## Technical Skills

### Required
- Blockchain infrastructure experience
- Linux system administration
- Kubernetes/Docker knowledge
- Solidity/smart contracts
- 24/7 operations capability

### Recommended
- DevOps/SRE experience
- Security best practices
- Incident response training

## Before You Start

### Checklist
- [ ] Hardware meets requirements
- [ ] Cloud account configured
- [ ] Domain names registered
- [ ] Capital available
- [ ] Team trained
- [ ] 24/7 on-call rotation ready
- [ ] Incident response plan documented

## Next Steps

- [Deployment Overview](./overview.md)
- [Testnet Deployment](./testnet.md)
- [Mainnet Deployment](./mainnet.md)


