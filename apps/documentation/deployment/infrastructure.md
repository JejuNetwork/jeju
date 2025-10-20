# Infrastructure Setup

Detailed infrastructure configuration for Jeju.

## Architecture

```
┌─────────────────────────────────────────┐
│ AWS VPC                                  │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ EKS Cluster                         │ │
│  │                                     │ │
│  │  ┌──────────────┐  ┌──────────────┐│ │
│  │  │  op-node     │  │  reth        ││ │
│  │  └──────────────┘  └──────────────┘│ │
│  │                                     │ │
│  │  ┌──────────────┐  ┌──────────────┐│ │
│  │  │  op-batcher  │  │  op-proposer││ │
│  │  └──────────────┘  └──────────────┘│ │
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ RDS PostgreSQL                     │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Terraform Setup

### 1. Configure Backend

```bash
cd terraform
cp backend.tf.example backend.tf
# Edit with your S3/DynamoDB settings
```

### 2. Deploy Network

```bash
cd terraform/environments/testnet
terraform init
terraform apply -target=module.network
```

### 3. Deploy EKS

```bash
terraform apply -target=module.eks
```

### 4. Deploy RDS

```bash
terraform apply -target=module.rds
```

## Kubernetes Setup

### 1. Configure kubectl

```bash
aws eks update-kubeconfig --region us-east-1 --name jeju-testnet
```

### 2. Install Controllers

```bash
# AWS Load Balancer Controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller

# Cert Manager
helm install cert-manager jetstack/cert-manager
```

### 3. Deploy Services

```bash
cd kubernetes/helmfile
helmfile -e testnet sync
```

## Resources

- [Deployment Overview](./overview)
- [Prerequisites](./prerequisites)
- [Monitoring Guide](./monitoring)


