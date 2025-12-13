# Run a Storage Node

Provide IPFS storage and earn from the storage marketplace.

## Requirements

### Hardware

CPU requires minimum 4 cores, recommended 8+ cores. RAM requires minimum 8 GB, recommended 16+ GB. Storage requires minimum 1 TB, recommended 10+ TB. Network requires minimum 100 Mbps, recommended 1 Gbps.

### Software

- Docker 24.0+
- Linux (Ubuntu 22.04)

### Staking

Minimum stake is 0.1 ETH.

## Step 1: Install Dependencies

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone Jeju
git clone https://github.com/elizaos/jeju.git
cd jeju/apps/storage
bun install
```

## Step 2: Configure Node

Create `.env`:

```bash
# Identity
PRIVATE_KEY=0x...

# Network
RPC_URL=https://rpc.jeju.network
NETWORK=mainnet

# Storage
STORAGE_PORT=4010
IPFS_REPO_PATH=/data/ipfs

# Pricing (per MB per month in wei)
STORAGE_PRICE=1000000000000000  # 0.001 ETH
```

## Step 3: Start IPFS

```bash
# Initialize IPFS
docker run -d --name ipfs \
  -v /data/ipfs:/data/ipfs \
  -p 4001:4001 \
  -p 5001:5001 \
  -p 8080:8080 \
  ipfs/kubo:latest

# Check IPFS
docker logs ipfs
curl http://localhost:5001/api/v0/id
```

## Step 4: Start Storage Node

```bash
# Start API
bun run node

# Or with Docker
docker compose -f docker-compose.storage.yml up -d
```

### Docker Compose

```yaml
# docker-compose.storage.yml
version: '3.8'

services:
  storage-api:
    build: .
    ports:
      - "4010:4010"
    environment:
      - PRIVATE_KEY=${PRIVATE_KEY}
      - IPFS_NODE_URL=http://ipfs:5001
      - STORAGE_PORT=4010
    depends_on:
      - ipfs
    volumes:
      - storage-data:/data

  ipfs:
    image: ipfs/kubo:latest
    ports:
      - "4001:4001"  # Swarm
      - "5001:5001"  # API
      - "8080:8080"  # Gateway
    volumes:
      - ipfs-data:/data/ipfs

volumes:
  storage-data:
  ipfs-data:
```

## Step 5: Register Provider

```bash
# Register on-chain
cast send $STORAGE_REGISTRY \
  "register(string,uint256,uint256)" \
  "https://storage.mynode.com:4010" \
  $STORAGE_CAPACITY \
  $STORAGE_PRICE \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 6: Verify

```bash
# Test upload
curl -X POST http://localhost:4010/api/upload \
  -F "file=@test.txt"

# Check registration
cast call $STORAGE_REGISTRY "getProviderByAddress(address)" $YOUR_ADDRESS
```

## Pricing

Set competitive pricing. Upload is suggested at 0.0001 ETH per MB. Pinning at 0.001 ETH per MB per month. Retrieval is typically free.

Update pricing:

```bash
cast send $STORAGE_REGISTRY "updatePricing(uint256)" \
  $NEW_PRICE \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Arweave Integration

For permanent storage, add Arweave:

```bash
# Add Arweave key
ARWEAVE_KEY_FILE=./arweave-keyfile.json

# Enable Arweave backend
ARWEAVE_ENABLED=true
ARWEAVE_GATEWAY=https://arweave.net
```

## Monitoring

### Health Check

```bash
curl http://localhost:4010/health
```

### Storage Stats

```bash
# Check IPFS stats
curl http://localhost:5001/api/v0/stats/repo

# Check pinned content
curl http://localhost:4010/api/pins
```

### Metrics

`storage_total_bytes` tracks total storage used. `storage_pins_count` counts the number of pins. `storage_requests_total` counts total requests.

## Earnings

Earnings from:
- Upload fees
- Pinning fees (recurring)
- x402 micropayments

### Claim Earnings

```bash
# Check balance
cast call $STORAGE_PAYMENTS "getBalance(address)" $YOUR_ADDRESS

# Withdraw
cast send $STORAGE_PAYMENTS "withdraw(uint256)" $AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Garbage Collection

IPFS doesn't automatically remove unpinned content:

```bash
# Run GC
docker exec ipfs ipfs repo gc

# Schedule GC (cron)
0 0 * * * docker exec ipfs ipfs repo gc
```

## Backup

### IPFS Data

```bash
# Export pins
docker exec ipfs ipfs pin ls > pins.txt

# Backup data
tar czf ipfs-backup-$(date +%Y%m%d).tar.gz /data/ipfs
```

### Recovery

```bash
# Restore data
tar xzf ipfs-backup.tar.gz -C /

# Re-pin content
cat pins.txt | while read cid type; do
  docker exec ipfs ipfs pin add $cid
done
```

## Maintenance

### Update

```bash
cd jeju
git pull
cd apps/storage
bun install
bun run node
```

### Go Offline

```bash
cast send $STORAGE_REGISTRY "setActive(bool)" false \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Unstake

```bash
cast send $STORAGE_STAKING "initiateUnstake(uint256)" $AMOUNT
# After cooldown
cast send $STORAGE_STAKING "completeUnstake()"
```

## Troubleshooting

### IPFS Not Connecting

```bash
# Check peers
docker exec ipfs ipfs swarm peers

# Add bootstrap nodes
docker exec ipfs ipfs bootstrap add /dnsaddr/bootstrap.libp2p.io/p2p/...
```

### Disk Full

```bash
# Check usage
df -h /data

# Run GC
docker exec ipfs ipfs repo gc

# Increase disk or remove old pins
```

### Upload Fails

```bash
# Check IPFS API
curl http://localhost:5001/api/v0/version

# Check logs
docker logs ipfs
```

