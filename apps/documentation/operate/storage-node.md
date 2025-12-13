# Run a Storage Node

Provide IPFS storage and earn fees.

## Requirements

### Hardware

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 1 TB | 10+ TB |
| Network | 100 Mbps | 1 Gbps |

### Staking

| Parameter | Value |
|-----------|-------|
| Minimum Stake | 0.1 ETH |

## Step 1: Install

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

git clone https://github.com/elizaos/jeju.git
cd jeju/apps/storage
bun install
```

## Step 2: Configure

```bash
# .env
PRIVATE_KEY=0x...
RPC_URL=https://rpc.jeju.network
STORAGE_PORT=4010
IPFS_REPO_PATH=/data/ipfs
STORAGE_PRICE=1000000000000000  # 0.001 ETH per MB/month
```

## Step 3: Start IPFS

```bash
docker run -d --name ipfs \
  -v /data/ipfs:/data/ipfs \
  -p 4001:4001 -p 5001:5001 -p 8080:8080 \
  ipfs/kubo:latest

curl http://localhost:5001/api/v0/id
```

## Step 4: Start Node

```bash
bun run node

# Or with Docker
docker compose -f docker-compose.storage.yml up -d
```

## Step 5: Register

```bash
cast send $STORAGE_REGISTRY \
  "register(string,uint256,uint256)" \
  "https://storage.mynode.com:4010" \
  $STORAGE_CAPACITY \
  $STORAGE_PRICE \
  --value 0.1ether \
  --rpc-url $RPC_URL --private-key $PK
```

## Pricing

| Operation | Suggested Price |
|-----------|-----------------|
| Upload | 0.0001 ETH/MB |
| Pin | 0.001 ETH/MB/month |
| Retrieval | Free |

```bash
cast send $STORAGE_REGISTRY "updatePricing(uint256)" $NEW_PRICE \
  --rpc-url $RPC_URL --private-key $PK
```

## Monitoring

```bash
# Health
curl http://localhost:4010/health

# IPFS stats
curl http://localhost:5001/api/v0/stats/repo

# Pins
curl http://localhost:4010/api/pins
```

## Earnings

```bash
# Check balance
cast call $STORAGE_PAYMENTS "getBalance(address)" $YOUR_ADDRESS

# Withdraw
cast send $STORAGE_PAYMENTS "withdraw(uint256)" $AMOUNT \
  --rpc-url $RPC_URL --private-key $PK
```

## Arweave Integration

For permanent storage:

```bash
ARWEAVE_ENABLED=true
ARWEAVE_KEY_FILE=./arweave-keyfile.json
ARWEAVE_GATEWAY=https://arweave.net
```

## Garbage Collection

```bash
# Run GC
docker exec ipfs ipfs repo gc

# Schedule (cron)
0 0 * * * docker exec ipfs ipfs repo gc
```

## Maintenance

```bash
# Update
cd jeju && git pull
cd apps/storage && bun install && bun run node

# Go offline
cast send $STORAGE_REGISTRY "setActive(bool)" false \
  --rpc-url $RPC_URL --private-key $PK

# Unstake
cast send $STORAGE_STAKING "initiateUnstake(uint256)" $AMOUNT
cast send $STORAGE_STAKING "completeUnstake()"
```

