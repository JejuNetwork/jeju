# Testnet Deployment Checklist

L1: Sepolia (11155111) → Jeju Testnet (420690)  
Time: 2-4 hours

## Prerequisites

- [ ] AWS account
- [ ] Sepolia ETH (0.5+ on deployer)
- [ ] Terraform, kubectl, Helm, Foundry, Bun installed
- [ ] Keys generated: deployer, batcher (0.2 ETH), proposer (0.1 ETH), sequencer

## Phase 1: Infrastructure

```bash
cd packages/deployment/terraform/environments/testnet
terraform init && terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform output -json > ../../../.terraform-outputs-testnet.json

aws eks update-kubeconfig --region us-east-1 --name jeju-testnet-cluster
kubectl create namespace op-stack
kubectl create namespace monitoring
```

## Phase 2: Contracts

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY="..."
forge script script/Deploy.s.sol \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify
```

Update `packages/config/chain/testnet.json` with deployed addresses.

```bash
NETWORK=testnet bun run --cwd packages/deployment scripts/l2-genesis.ts
```

## Phase 3: Services

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet sync
watch kubectl get pods -n op-stack
```

## Phase 4: Verify

```bash
# Logs
kubectl logs -n op-stack deployment/op-node -f
kubectl logs -n op-stack deployment/op-batcher -f

# RPC
kubectl port-forward -n op-stack svc/reth 8545:8545 &
cast block latest --rpc-url http://127.0.0.1:8545

# Transaction
cast send 0x... --value 0.01ether --rpc-url http://127.0.0.1:8545 --private-key $KEY
```

## Phase 5: Monitoring

```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000 &
# Open http://127.0.0.1:3000 (admin/admin)
```

## Week 1 Checks

- [ ] 24h: No crashes
- [ ] Batcher/proposer balances (top up if < 0.05 ETH)
- [ ] State roots posting hourly
- [ ] Batches posting every 5-10 min
- [ ] Bridge deposits/withdrawals working

## Rollback

```bash
# Infrastructure
terraform destroy

# Services
helmfile -e testnet destroy

# Emergency stop
kubectl scale -n op-stack deployment/op-node --replicas=0
kubectl scale -n op-stack deployment/op-batcher --replicas=0
```
