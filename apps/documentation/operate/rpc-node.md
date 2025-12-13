# Run an RPC Node

Operate RPC infrastructure and earn rewards.

## Requirements

### Hardware

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 8 cores | 16+ cores |
| RAM | 16 GB | 32+ GB |
| Storage | 500 GB SSD | 1 TB NVMe |
| Network | 100 Mbps | 1 Gbps |

### Staking

| Parameter | Value |
|-----------|-------|
| Minimum Stake | 1,000 JEJU |
| Unstaking Period | 7 days |

## Step 1: Install

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

git clone https://github.com/elizaos/jeju.git
cd jeju
```

## Step 2: Configure

Create `.env`:

```bash
NODE_NAME=my-rpc-node
NODE_ENDPOINT=https://rpc.mynode.com
NETWORK=mainnet
PRIVATE_KEY=0x...
STAKE_AMOUNT=1000000000000000000000  # 1000 JEJU
```

## Step 3: Start

```bash
docker compose -f docker-compose.node.yml up -d
```

```yaml
# docker-compose.node.yml
services:
  op-reth:
    image: ghcr.io/paradigmxyz/op-reth:latest
    ports:
      - "9545:9545"
      - "9546:9546"
    volumes:
      - ./data:/data
    command: >
      node --chain jeju
      --http --http.addr 0.0.0.0
      --ws --ws.addr 0.0.0.0
      --datadir /data
```

## Step 4: Register

```bash
cast send $NODE_STAKING_MANAGER \
  "register(string,address,uint256)" \
  "$NODE_ENDPOINT" $STAKE_TOKEN $STAKE_AMOUNT \
  --rpc-url $RPC_URL --private-key $PK
```

## Monitoring

```bash
# Block number
curl -X POST http://localhost:9545 \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Sync status
curl -X POST http://localhost:9545 \
  -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
```

## Rewards

Based on:
- Uptime (50%)
- Latency (30%)
- Request volume (20%)

```bash
# Check rewards
cast call $NODE_STAKING_MANAGER "getPendingRewards(address)" $YOUR_ADDRESS

# Claim
cast send $NODE_STAKING_MANAGER "claimRewards()" --rpc-url $RPC --private-key $PK
```

## Slashing

| Offense | Penalty |
|---------|---------|
| Downtime >1 hour | Warning |
| Downtime >24 hours | 5% stake |
| Repeated downtime | Up to 100% |
| Malicious responses | 100% |

## Maintenance

```bash
# Update
docker compose -f docker-compose.node.yml pull
docker compose -f docker-compose.node.yml up -d

# Unstake
cast send $NODE_STAKING_MANAGER "initiateUnstake(uint256)" $AMOUNT
# After 7 days
cast send $NODE_STAKING_MANAGER "completeUnstake()"
```

