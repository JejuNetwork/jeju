# Infrastructure Deployment

AWS infrastructure and Kubernetes setup for Jeju.

## Architecture

CloudFront CDN sits in front of the Application Load Balancer, which distributes traffic to the EKS Cluster (running op-node, op-reth, and apps), RDS PostgreSQL (for Indexer and Leaderboard databases), and ElastiCache (for session caching).

## Terraform

### Directory Structure

The `packages/deployment/terraform/` directory contains `modules/` with vpc, eks, rds, and elasticache modules, `environments/` with testnet.tfvars and mainnet.tfvars, plus main.tf, variables.tf, and outputs.tf.

### Deploy Infrastructure

```bash
cd packages/deployment/terraform

terraform init
terraform plan -var-file=testnet.tfvars -out=plan.tfplan
terraform apply plan.tfplan
```

### Key Resources

For testnet: EKS has 7 nodes, RDS uses db.t3.medium, ElastiCache uses cache.t3.micro, and there's 1 ALB. For mainnet: EKS has 15 nodes, RDS uses db.r6g.large, ElastiCache uses cache.r6g.large, and there are 2 ALBs for HA.

## Kubernetes

### Directory Structure

The `packages/deployment/kubernetes/` directory contains `helm/` with charts for op-node, op-reth, indexer, gateway, and monitoring, plus `helmfile/` with helmfile.yaml and environments.

### Deploy Services

```bash
cd packages/deployment/kubernetes/helmfile

helmfile -e testnet diff    # Preview
helmfile -e testnet sync    # Apply
helmfile -e testnet rollback # Rollback if needed
```

## Secrets Management

### AWS Secrets Manager

```bash
aws secretsmanager create-secret \
  --name jeju/testnet/deployer \
  --secret-string '{"privateKey":"0x..."}'

kubectl create secret generic jeju-secrets \
  --from-literal=deployer-key=$(aws secretsmanager get-secret-value \
    --secret-id jeju/testnet/deployer \
    --query SecretString --output text | jq -r .privateKey)
```

Use External Secrets Operator for automated secret synchronization between AWS Secrets Manager and Kubernetes.

## Monitoring

### Prometheus Stack

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring \
  -f helm/monitoring/values.yaml
```

Pre-configured Grafana dashboards cover block production, transaction throughput, RPC latency, L1 data costs, and node health.

### Alerts

Critical alerts include BlockProductionStopped (0 blocks in 5 minutes) and HighRPCLatency (p99 over 0.5 seconds).

## Scaling

### Horizontal Pod Autoscaler

Services like Gateway autoscale between 2 and 10 replicas based on CPU utilization (70% target).

### Node Autoscaling

EKS cluster autoscaler automatically adds nodes based on pending pods.

## Backup & Recovery

### Database Backups

RDS automated backups have 7-day retention. Create manual snapshots with `aws rds create-db-snapshot --db-instance-identifier jeju-indexer --db-snapshot-identifier jeju-indexer-$(date +%Y%m%d)`.

### State Backups

Backup chain data from op-reth pods using tar to create compressed archives of the data directory.

## Troubleshooting

**Pod Not Starting**: Check events with `kubectl describe pod $POD_NAME -n jeju` and logs with `kubectl logs $POD_NAME -n jeju --previous`.

**Node Issues**: Check node status with `kubectl get nodes` and `kubectl describe node $NODE_NAME`. Drain problematic nodes with `kubectl drain $NODE_NAME --ignore-daemonsets`.

**Database Connection**: Port forward to RDS with `kubectl port-forward svc/rds-proxy 5432:5432`, then connect with `psql -h localhost -U jeju indexer`.
