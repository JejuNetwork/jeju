# Jeju Messaging Infrastructure Helm Chart

Deploys the complete decentralized messaging stack for Babylon.

## Components

| Service | Purpose | Port |
|---------|---------|------|
| **Relay Nodes** | Message routing & delivery | 3200 (HTTP), 3201 (WS) |
| **KMS Service** | Key generation & signing | 3300 |
| **Farcaster Sync** | Public social data sync | Internal |

## Prerequisites

1. **Kubernetes cluster** with:
   - EKS with IRSA (for AWS secrets access)
   - Nginx Ingress Controller
   - cert-manager (optional, for TLS)

2. **Deployed contracts** on Jeju L2:
   - KeyRegistry
   - MessageNodeRegistry

3. **CovenantSQL cluster** running and accessible

4. **Secrets configured**:
   - Relay operator keys
   - KMS master key
   - CovenantSQL credentials

## Installation

### 1. Deploy Contracts First

```bash
cd packages/deployment
bun run scripts/deploy-messaging-contracts.ts --network testnet
```

This will output contract addresses to use in the next step.

### 2. Create Secrets

```bash
kubectl create namespace jeju-messaging

# Operator keys (JSON array of private keys)
kubectl create secret generic messaging-operator-keys \
  --namespace jeju-messaging \
  --from-literal=private-keys='["0x...","0x...","0x..."]'

# KMS master key
kubectl create secret generic kms-master-key \
  --namespace jeju-messaging \
  --from-literal=master-key='your-master-key-here'

# CovenantSQL credentials
kubectl create secret generic covenantsql-credentials \
  --namespace jeju-messaging \
  --from-literal=credentials='0x-your-cql-private-key'
```

### 3. Create Values Override

Create `values-testnet.yaml`:

```yaml
global:
  environment: testnet
  domain: jeju.network

relay:
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/jeju-messaging-testnet-role
  
  config:
    keyRegistryAddress: "0x..."  # From contract deployment
    nodeRegistryAddress: "0x..."  # From contract deployment
    covenantsqlNodes: "http://cql.testnet.jeju.network:8546"

kms:
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/jeju-messaging-testnet-role
  
  config:
    providers:
      awsKms:
        keyId: "arn:aws:kms:us-east-1:ACCOUNT:key/KEY-ID"

relay:
  ingress:
    hosts:
      - host: relay.testnet.jeju.network
        paths:
          - path: /
            pathType: Prefix
```

### 4. Deploy

```bash
helm install messaging . \
  --namespace jeju-messaging \
  --values values-testnet.yaml
```

Or with Helmfile:

```bash
cd packages/deployment
NETWORK=testnet bun run scripts/helmfile.ts sync --only messaging
```

## Configuration

### Relay Node Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `relay.replicaCount` | Number of relay nodes | 3 |
| `relay.config.port` | HTTP API port | 3200 |
| `relay.config.wsPort` | WebSocket port | 3201 |
| `relay.config.jejuRpcUrl` | Jeju L2 RPC URL | `https://testnet-rpc.jeju.network` |
| `relay.config.keyRegistryAddress` | KeyRegistry contract | Required |
| `relay.config.nodeRegistryAddress` | MessageNodeRegistry contract | Required |
| `relay.config.covenantsqlNodes` | CovenantSQL endpoints | Required |

### KMS Service Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `kms.replicaCount` | Number of KMS replicas | 2 |
| `kms.config.port` | API port | 3300 |
| `kms.config.providers.local.enabled` | Use local key generation | true |
| `kms.config.providers.awsKms.enabled` | Use AWS KMS | true |
| `kms.config.providers.awsKms.keyId` | AWS KMS key ARN | - |

### Farcaster Sync Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `farcasterSync.enabled` | Enable Farcaster sync | true |
| `farcasterSync.config.hubUrl` | Farcaster Hub URL | `nemes.farcaster.xyz:2283` |
| `farcasterSync.config.syncInterval` | Sync interval (ms) | 60000 |

## Monitoring

### Prometheus Metrics

All services expose metrics at `/metrics`:

- `message_delivery_latency_seconds` - Message delivery latency histogram
- `messages_relayed_total` - Total messages relayed
- `active_connections` - Active WebSocket connections
- `key_generation_latency_seconds` - KMS key generation latency

### Alerts

Pre-configured alerts in `values.yaml`:

- `RelayNodeDown` - Relay node unhealthy for 5m
- `HighMessageLatency` - P99 latency > 5s

### Dashboards

Import Grafana dashboards from `/monitoring/dashboards/`:

- `messaging-overview.json` - Overall system health
- `relay-performance.json` - Relay node metrics
- `kms-operations.json` - KMS service metrics

## Operations

### Scaling

```bash
# Scale relay nodes
kubectl scale deployment messaging-relay \
  --namespace jeju-messaging \
  --replicas 5

# Or enable HPA
helm upgrade messaging . \
  --set relay.autoscaling.enabled=true \
  --set relay.autoscaling.maxReplicas=10
```

### Rolling Update

```bash
helm upgrade messaging . \
  --set relay.image.tag=v1.1.0
```

### Troubleshooting

```bash
# Check pod status
kubectl get pods -n jeju-messaging

# View relay logs
kubectl logs -f -l app.kubernetes.io/component=relay -n jeju-messaging

# View KMS logs
kubectl logs -f -l app.kubernetes.io/component=kms -n jeju-messaging

# Check service health
kubectl exec -it deployment/messaging-relay -n jeju-messaging \
  -- curl http://localhost:3200/health
```

## Security

### Network Policies

Network policies restrict traffic:

- Relay nodes only accept traffic from ALB
- KMS only accepts traffic from relay nodes
- All egress is allowed (for CovenantSQL, Jeju L2)

### Secrets Management

- All secrets use AWS Secrets Manager (via IRSA)
- KMS master key stored in AWS Secrets Manager
- Operator keys rotated via Kubernetes secrets

### TLS

- TLS termination at ALB/Ingress
- Internal traffic uses mTLS (optional)

## Disaster Recovery

### Backup Strategy

1. **CovenantSQL**: Automatic replication across nodes
2. **Secrets**: AWS Secrets Manager versioning
3. **Config**: GitOps via Helm values

### Recovery Procedures

```bash
# Redeploy from scratch
helm install messaging . \
  --namespace jeju-messaging \
  --values values-testnet.yaml

# CovenantSQL will sync from other nodes automatically
```

## Upgrading

### From v0.x to v1.x

1. Back up secrets
2. Update Helm values for new schema
3. `helm upgrade messaging . --values values-testnet.yaml`

## Support

- Slack: #jeju-infrastructure
- PagerDuty: jeju-on-call

