# Infrastructure

## Architecture

```
AWS VPC
├── EKS Cluster
│   ├── op-node
│   ├── reth
│   ├── op-batcher
│   └── op-proposer
└── RDS PostgreSQL
```

## Terraform

```bash
cd packages/deployment/terraform/environments/{testnet|mainnet}
terraform init

# Deploy in order
terraform apply -target=module.network
terraform apply -target=module.eks
terraform apply -target=module.rds
terraform apply
```

## Kubernetes

```bash
# Configure kubectl
aws eks update-kubeconfig --region us-east-1 --name jeju-{env}

# Install controllers
helm install aws-load-balancer-controller eks/aws-load-balancer-controller
helm install cert-manager jetstack/cert-manager

# Deploy services
cd packages/deployment/kubernetes/helmfile
helmfile -e {testnet|mainnet} sync
```
