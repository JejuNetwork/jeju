# Running Your Own RPC Node

This guide explains how to run your own Jeju RPC node for maximum decentralization and reliability.

## Why Run Your Own Node?

- **Decentralization**: Don't rely on third parties
- **Privacy**: No one can see your requests
- **Reliability**: No rate limits or downtime from providers
- **Performance**: Lower latency for your region
- **Cost**: Free once infrastructure is paid for

## Requirements

### Hardware Requirements

#### Full RPC Node (Pruned)
- **CPU**: 8+ cores
- **RAM**: 16+ GB
- **Storage**: 500+ GB SSD (grows over time)
- **Network**: 100+ Mbps, high bandwidth
- **Uptime**: 99%+ recommended

#### Archive Node (Full History)
- **CPU**: 16+ cores
- **RAM**: 64+ GB
- **Storage**: 2+ TB NVMe SSD (grows over time)
- **Network**: 1+ Gbps, very high bandwidth
- **Uptime**: 99.9%+ recommended

### Software Requirements
- Docker & Docker Compose OR
- Kubernetes (for production/scale)
- 100GB+ free for snapshots during sync

## Quick Start (Docker)

### 1. Install Dependencies

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Create Configuration

```bash
mkdir -p ~/jeju-rpc && cd ~/jeju-rpc
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  reth:
    image: ghcr.io/paradigmxyz/op-reth:v1.0.3
    container_name: jeju-rpc
    restart: unless-stopped
    ports:
      - "8545:8545"  # HTTP RPC
      - "8546:8546"  # WebSocket
      - "30303:30303"  # P2P
    volumes:
      - ./data:/data
      - ./jwt-secret.txt:/secrets/jwt-secret.txt:ro
    command:
      - op-reth
      - node
      - --chain=optimism
      - --datadir=/data
      - --http
      - --http.addr=0.0.0.0
      - --http.port=8545
      - --http.api=eth,net,web3,txpool,trace
      - --http.corsdomain=*
      - --ws
      - --ws.addr=0.0.0.0
      - --ws.port=8546
      - --ws.api=eth,net,web3,txpool,trace
      - --ws.origins=*
      - --authrpc.addr=0.0.0.0
      - --authrpc.port=8551
      - --authrpc.jwtsecret=/secrets/jwt-secret.txt
      - --port=30303
      - --max-outbound-peers=100
      - --metrics=0.0.0.0:9001
      - --pruning=full  # Use --full for archive node
      - --log.stdout.format=json

  op-node:
    image: us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.7.6
    container_name: jeju-op-node
    restart: unless-stopped
    ports:
      - "9545:9545"  # RPC
      - "9003:9003"  # P2P
    volumes:
      - ./op-data:/data
      - ./jwt-secret.txt:/secrets/jwt-secret.txt:ro
      - ./rollup.json:/config/rollup.json:ro
    command:
      - op-node
      - --network=mainnet-l2
      - --rollup.config=/config/rollup.json
      - --l1=https://mainnet.base.org  # Base L1
      - --l1.rpckind=alchemy
      - --l2=http://reth:8551
      - --l2.jwt-secret=/secrets/jwt-secret.txt
      - --rpc.addr=0.0.0.0
      - --rpc.port=9545
      - --p2p.listen.ip=0.0.0.0
      - --p2p.listen.tcp=9003
      - --p2p.listen.udp=9003
      - --metrics.enabled
      - --metrics.addr=0.0.0.0
      - --metrics.port=7300
    depends_on:
      - reth
```

### 3. Generate JWT Secret

```bash
openssl rand -hex 32 > jwt-secret.txt
```

### 4. Download Rollup Config

```bash
# Get the rollup configuration from Jeju
curl -o rollup.json https://raw.githubusercontent.com/elizaos/jeju/main/config/rollup/mainnet.json
```

### 5. Start Node

```bash
docker-compose up -d
```

### 6. Check Sync Status

```bash
# Check logs
docker-compose logs -f

# Check sync status
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'

# Should return false when fully synced
```

## Production Deployment (Kubernetes)

For production RPC hosting at scale, use Kubernetes:

### 1. Clone Repository

```bash
git clone https://github.com/elizaos/jeju.git
cd jeju
```

### 2. Setup Infrastructure

```bash
# Deploy to AWS
cd terraform/environments/mainnet
terraform init
terraform apply

# Configure kubectl
aws eks update-kubeconfig --region us-east-1 --name jeju-mainnet
```

### 3. Install Required Controllers

```bash
# Install AWS Load Balancer Controller
kubectl apply -k "github.com/aws/eks-charts/stable/aws-load-balancer-controller//crds?ref=master"
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=jeju-mainnet

# Install Cert-Manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  -n cert-manager \
  --create-namespace \
  -f kubernetes/helm/cert-manager/values-mainnet.yaml

# Install Nginx Ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx \
  --create-namespace \
  -f kubernetes/helm/ingress-nginx/values-mainnet.yaml
```

### 4. Deploy Certificate Issuer

```bash
kubectl apply -f kubernetes/manifests/cert-issuer.yaml
```

### 5. Deploy RPC Nodes

```bash
# Deploy multiple RPC nodes
kubectl apply -f kubernetes/manifests/rpc-nodes.yaml

# Deploy RPC gateway with rate limiting
helm install rpc-gateway ./kubernetes/helm/rpc-gateway \
  -n rpc \
  --create-namespace
```

### 6. Configure DNS

Point your DNS to the load balancer:

```bash
# Get load balancer address
kubectl get ingress -n rpc rpc-gateway -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

# Create DNS records
rpc.jeju.network -> CNAME -> <load-balancer-address>
ws.jeju.network -> CNAME -> <load-balancer-address>
```

## Monitoring

### Metrics

Access Prometheus metrics:

```bash
# Reth metrics
curl http://localhost:9001/metrics

# Op-node metrics
curl http://localhost:7300/metrics

# Nginx metrics
curl http://localhost:9113/metrics
```

### Grafana Dashboard

Import the provided dashboard:

```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Open http://localhost:3000
# Import dashboard from monitoring/grafana/dashboards/op-stack.json
```

## Rate Limiting

The RPC gateway includes built-in rate limiting:

- **100 requests/second** per IP
- **5,000 requests/minute** per IP
- **100,000 requests/hour** per IP
- **10 concurrent connections** per IP

Adjust in `kubernetes/helm/rpc-gateway/values.yaml`:

```yaml
rateLimit:
  requestsPerSecond: 100
  requestsPerMinute: 5000
  maxConnectionsPerIp: 10
```

## Security Best Practices

### Firewall Rules

```bash
# Allow only necessary ports
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 8545/tcp    # RPC (only if public)
ufw allow 8546/tcp    # WebSocket (only if public)
ufw allow 30303/tcp   # P2P
ufw allow 30303/udp   # P2P
ufw enable
```

### DDoS Protection

For production, use CloudFlare in front:

1. Add your domain to CloudFlare
2. Enable "Under Attack" mode if needed
3. Configure rate limiting rules
4. Enable bot protection

### SSL/TLS

Cert-manager automatically provisions Let's Encrypt certificates. Ensure:

- Certificates auto-renew (check after 60 days)
- Only TLS 1.2+ is enabled
- Strong cipher suites are used

## Maintenance

### Updates

```bash
# Update Docker containers
docker-compose pull
docker-compose up -d

# Update Kubernetes
helm upgrade rpc-gateway ./kubernetes/helm/rpc-gateway -n rpc
```

### Backups

No need to backup the full data directory (can re-sync). Backup only:

```bash
# Backup configuration
tar -czf jeju-rpc-config-$(date +%Y%m%d).tar.gz \
  docker-compose.yml \
  jwt-secret.txt \
  rollup.json
```

### Pruning

Reth automatically prunes old state. For archive nodes, monitor disk usage:

```bash
# Check disk usage
df -h

# If needed, increase storage
# For cloud: resize EBS volume
# For bare metal: add disk and migrate data
```

## Infrastructure Options

### Cloud (AWS, GCP, Azure)

**General RPC Node**:
- 8-core instance with good CPU performance
- 500GB high-performance storage
- Sufficient network bandwidth
- Suitable for most RPC workloads

**Archive Node**:
- 16-core instance with high memory
- 2TB+ high-performance NVMe storage
- High network bandwidth for historical queries
- Required for full historical data access

**At Scale**: Multiple nodes provide high availability and can serve millions of requests per day

### Bare Metal

- Purchase server hardware
- Colocation or home hosting
- Network connectivity
- Lower operating costs after initial hardware investment

## Support

- **Documentation**: [docs.jeju.network](https://docs.jeju.network)
- **Discord**: [#node-operators](https://discord.gg/jeju)
- **GitHub**: [github.com/elizaos/jeju](https://github.com/elizaos/jeju)

## Next Steps

- [**Network Information**](/network/mainnet) - Production network details
- [**Node Operator Handbook**](/operators/node-operator-handbook) - Comprehensive operator guide
- [**Monitoring Guide**](/deployment/monitoring) - Setup monitoring and alerting


