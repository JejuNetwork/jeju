# Mainnet Deployment

Deploy Jeju mainnet on Base.

## Overview

- **Settlement**: Base Mainnet (Chain ID: 8453)
- **Jeju Mainnet**: Chain ID 420691
- **Time**: 1-2 days
- **Requirements**: Significant infrastructure budget

## Prerequisites

- Full security audit
- Insurance coverage
- Legal entity established
- 24/7 operations team
- See [Prerequisites](./prerequisites.md)

## Deployment Steps

### 1. Security Audit

**Required before mainnet**:
- Full audit by reputable firm ($50k-200k)
- Bug bounty program live
- All findings addressed

### 2. Deploy Infrastructure

```bash
cd terraform/environments/mainnet
terraform init
terraform apply
```

### 3. Deploy Contracts to Base

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_KEY \
  --broadcast \
  --verify
```

### 4. Update Configuration

Update `config/chain/mainnet.json` with deployed addresses.

### 5. Deploy Kubernetes

```bash
cd kubernetes/helmfile
helmfile -e mainnet sync
```

### 6. Monitor for 24 Hours

Before announcing:
- [ ] Block production stable
- [ ] No errors in logs
- [ ] Settlement to Base working
- [ ] RPC endpoints responsive
- [ ] Monitoring active

## Security Checklist

- [ ] Audit complete
- [ ] Bug bounty active
- [ ] Multisig configured
- [ ] Emergency procedures documented
- [ ] Insurance obtained
- [ ] 24/7 on-call ready

## Resources

- [Deployment Overview](./overview.md)
- [Prerequisites](./prerequisites.md)
- [Monitoring](./monitoring.md)
- [Runbooks](./runbooks.md)

