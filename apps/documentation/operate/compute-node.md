# Run a Compute Node

Provide AI inference and earn from the marketplace.

## Requirements

### Hardware

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU | RTX 3090 (24GB) | H100 (80GB) |
| CPU | 8 cores | 16+ cores |
| RAM | 32 GB | 64+ GB |
| Storage | 500 GB SSD | 1 TB NVMe |

### Staking

| Parameter | Value |
|-----------|-------|
| Minimum Stake | 0.1 ETH |

## Step 1: Install

```bash
# Docker with NVIDIA support
curl -fsSL https://get.docker.com | sh
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo systemctl restart docker

# Clone and install
git clone https://github.com/elizaos/jeju.git
cd jeju/apps/compute
bun install
```

## Step 2: Configure

```bash
# .env
PRIVATE_KEY=0x...
RPC_URL=https://rpc.jeju.network
COMPUTE_PORT=4007
MODEL_BACKEND=ollama
OLLAMA_HOST=http://localhost:11434
```

## Step 3: Start Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama2
ollama pull mixtral
ollama serve &
```

## Step 4: Start Node

```bash
bun run node

# Or with Docker
docker compose -f docker-compose.compute.yml up -d
```

## Step 5: Register

```bash
curl http://localhost:4007/v1/hardware > attestation.json

cast send $COMPUTE_REGISTRY \
  "register(string,string,uint256)" \
  "https://compute.mynode.com:4007" \
  "$(cat attestation.json | jq -c)" \
  $(cast --to-wei 0.01) \
  --value 0.1ether \
  --rpc-url $RPC_URL --private-key $PK
```

## Pricing

```bash
# Set price (per hour in wei)
cast send $COMPUTE_REGISTRY "updatePricing(uint256)" \
  $(cast --to-wei 0.01) \
  --rpc-url $RPC_URL --private-key $PK
```

| GPU | Suggested Price |
|-----|-----------------|
| RTX 3090 | 0.005 ETH/hr |
| A100 | 0.015 ETH/hr |
| H100 | 0.025 ETH/hr |

## Monitoring

```bash
# Health
curl http://localhost:4007/health

# GPU usage
nvidia-smi --query-gpu=utilization.gpu --format=csv

# Sessions
curl http://localhost:4007/v1/sessions
```

## Earnings

```bash
# Check balance
cast call $INFERENCE_SERVING "getBalance(address)" $YOUR_ADDRESS

# Withdraw
cast send $INFERENCE_SERVING "withdraw(uint256)" $AMOUNT \
  --rpc-url $RPC_URL --private-key $PK
```

## TEE Support

For higher trust:

```bash
TDX_ENABLED=true      # Intel TDX
CC_ENABLED=true       # NVIDIA Confidential Computing
```

## Maintenance

```bash
# Update
cd jeju && git pull
cd apps/compute && bun install && bun run node

# Go offline
cast send $COMPUTE_REGISTRY "setActive(bool)" false \
  --rpc-url $RPC_URL --private-key $PK

# Unstake
cast send $COMPUTE_STAKING "initiateUnstake(uint256)" $AMOUNT
cast send $COMPUTE_STAKING "completeUnstake()"
```

