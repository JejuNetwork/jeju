# Run RPC Node

## Requirements

**Full node**: 8 cores, 16GB RAM, 500GB SSD  
**Archive node**: 16 cores, 64GB RAM, 2TB NVMe

## Docker Quick Start

```bash
mkdir -p ~/jeju-rpc && cd ~/jeju-rpc
openssl rand -hex 32 > jwt-secret.txt
curl -o rollup.json https://raw.githubusercontent.com/elizaos/jeju/main/contracts/deploy-config/mainnet.json
```

`docker-compose.yml`:
```yaml
version: '3.8'
services:
  reth:
    image: ghcr.io/paradigmxyz/op-reth:v1.0.3
    ports: ["8545:8545", "8546:8546", "30303:30303"]
    volumes: ["./data:/data", "./jwt-secret.txt:/secrets/jwt-secret.txt:ro"]
    command:
      - op-reth
      - node
      - --chain=optimism
      - --datadir=/data
      - --http --http.addr=0.0.0.0 --http.port=8545
      - --http.api=eth,net,web3,txpool,trace
      - --ws --ws.addr=0.0.0.0 --ws.port=8546
      - --authrpc.addr=0.0.0.0 --authrpc.port=8551
      - --authrpc.jwtsecret=/secrets/jwt-secret.txt

  op-node:
    image: us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.7.6
    ports: ["9545:9545"]
    volumes: ["./jwt-secret.txt:/secrets/jwt-secret.txt:ro", "./rollup.json:/config/rollup.json:ro"]
    command:
      - op-node
      - --rollup.config=/config/rollup.json
      - --l1=https://eth.llamarpc.com
      - --l2=http://reth:8551
      - --l2.jwt-secret=/secrets/jwt-secret.txt
      - --rpc.addr=0.0.0.0 --rpc.port=9545
    depends_on: [reth]
```

```bash
docker-compose up -d

# Check sync
curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
```

## Kubernetes (Production)

```bash
cd packages/deployment/terraform/environments/mainnet
terraform init && terraform apply

cd packages/deployment/kubernetes/helmfile
helmfile -e mainnet sync
```

## Rate Limits

- 100 req/s per IP
- 5,000 req/min per IP
- 10 concurrent connections

## Firewall

```bash
ufw default deny incoming
ufw allow 22/tcp 8545/tcp 8546/tcp 30303/tcp 30303/udp
ufw enable
```
