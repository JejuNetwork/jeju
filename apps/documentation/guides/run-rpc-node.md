# Run an RPC Node

Operate RPC infrastructure and earn staking rewards.

## Requirements

### Hardware

CPU requires minimum 8 cores, recommended 16+ cores. RAM requires minimum 16 GB, recommended 32+ GB. Storage requires minimum 500 GB SSD, recommended 1 TB NVMe. Network requires minimum 100 Mbps, recommended 1 Gbps.

### Software

- Docker 24.0+
- Linux (Ubuntu 22.04 recommended)

### Staking

Minimum stake is 1,000 JEJU or equivalent. Unstaking period is 7 days.

## Step 1: Install Dependencies

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone Jeju
git clone https://github.com/elizaos/jeju.git
cd jeju
```

## Step 2: Configure Node

Create `.env`:

```bash
# Node identity
NODE_NAME=my-rpc-node
NODE_ENDPOINT=https://rpc.mynode.com

# Network
NETWORK=mainnet
L2_RPC_URL=https://rpc.jeju.network  # Peer nodes

# Staking
PRIVATE_KEY=0x...  # Operator wallet
STAKE_TOKEN=0x...  # Token to stake (JEJU address)
STAKE_AMOUNT=1000000000000000000000  # 1000 tokens
```

## Step 3: Start Node

```bash
# Build and start
docker compose -f docker-compose.node.yml up -d

# Check status
docker compose -f docker-compose.node.yml ps
docker compose -f docker-compose.node.yml logs -f op-reth
```

### Docker Compose

```yaml
# docker-compose.node.yml
version: '3.8'

services:
  op-reth:
    image: ghcr.io/paradigmxyz/op-reth:latest
    ports:
      - "9545:9545"  # HTTP RPC
      - "9546:9546"  # WebSocket
    volumes:
      - ./data:/data
    environment:
      - RUST_LOG=info
    command: >
      node
      --chain jeju
      --http
      --http.addr 0.0.0.0
      --http.port 9545
      --ws
      --ws.addr 0.0.0.0
      --ws.port 9546
      --datadir /data
```

## Step 4: Register Node

Once synced, register on-chain:

```bash
# Approve stake token
cast send $STAKE_TOKEN "approve(address,uint256)" \
  $NODE_STAKING_MANAGER \
  $STAKE_AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK

# Register node
cast send $NODE_STAKING_MANAGER \
  "register(string,address,uint256)" \
  "$NODE_ENDPOINT" \
  $STAKE_TOKEN \
  $STAKE_AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 5: Verify Registration

```bash
# Check registration
cast call $NODE_STAKING_MANAGER "getNodeByOperator(address)" $YOUR_ADDRESS

# Check in Gateway UI
# https://gateway.jeju.network/nodes
```

## Monitoring

### Health Checks

```bash
# Block number
curl -X POST http://localhost:9545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Sync status
curl -X POST http://localhost:9545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
```

### Prometheus Metrics

Expose metrics at `:6060/debug/metrics/prometheus`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'jeju-rpc-node'
    static_configs:
      - targets: ['localhost:6060']
    metrics_path: /debug/metrics/prometheus
```

### Key Metrics

`rpc_requests_total` tracks total RPC requests. `rpc_request_duration_seconds` measures request latency. `eth_block_number` shows current block. `eth_peers_count` tracks connected peers.

## Rewards

Rewards are distributed based on:
- Uptime (50% weight)
- Latency (30% weight)
- Request volume (20% weight)

### Claim Rewards

```bash
# Check pending rewards
cast call $NODE_STAKING_MANAGER "getPendingRewards(address)" $YOUR_ADDRESS

# Claim
cast send $NODE_STAKING_MANAGER "claimRewards()" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Slashing

Nodes can be slashed for various offenses. Downtime over 1 hour results in a warning. Downtime over 24 hours costs 5% of stake. Repeated downtime can cost up to 100%. Malicious responses result in 100% stake slashing.

## Maintenance

### Update Node

```bash
# Pull latest image
docker compose -f docker-compose.node.yml pull

# Restart
docker compose -f docker-compose.node.yml up -d
```

### Backup Data

```bash
# Stop node
docker compose -f docker-compose.node.yml stop

# Backup
tar czf backup-$(date +%Y%m%d).tar.gz ./data

# Restart
docker compose -f docker-compose.node.yml start
```

### Unstake

```bash
# Initiate unstake (7-day cooldown)
cast send $NODE_STAKING_MANAGER "initiateUnstake(uint256)" $AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK

# After 7 days, complete
cast send $NODE_STAKING_MANAGER "completeUnstake()" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Troubleshooting

### Node Not Syncing

```bash
# Check logs
docker compose logs op-reth | tail -100

# Check peers
curl -X POST http://localhost:9545 \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

### High Latency

- Check network connectivity
- Increase hardware resources
- Review disk I/O

### Connection Refused

- Verify ports are open
- Check firewall rules
- Confirm Docker is running

