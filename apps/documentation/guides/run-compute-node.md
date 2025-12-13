# Run a Compute Node

Provide AI inference and earn from the compute marketplace.

## Requirements

### Hardware

GPU requires minimum RTX 3090 (24GB), recommended H100 (80GB). CPU requires minimum 8 cores, recommended 16+ cores. RAM requires minimum 32 GB, recommended 64+ GB. Storage requires minimum 500 GB SSD, recommended 1 TB NVMe.

### Software

- Docker 24.0+
- NVIDIA drivers + CUDA
- Linux (Ubuntu 22.04)

### Staking

Minimum stake is 0.1 ETH.

## Step 1: Install Dependencies

```bash
# Docker with NVIDIA support
curl -fsSL https://get.docker.com | sh
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo systemctl restart docker

# Clone Jeju
git clone https://github.com/elizaos/jeju.git
cd jeju/apps/compute
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

# Compute
COMPUTE_PORT=4007
SSH_PORT=2222
DOCKER_ENABLED=true
MAX_RENTALS=10

# Model backend
MODEL_BACKEND=ollama
MODEL_NAME=llama2
OLLAMA_HOST=http://localhost:11434
```

## Step 3: Start Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull llama2
ollama pull mixtral

# Start (runs in background)
ollama serve &
```

## Step 4: Start Compute Node

```bash
# Start node
bun run node

# Or with Docker
docker compose -f docker-compose.compute.yml up -d
```

### Docker Compose

```yaml
# docker-compose.compute.yml
version: '3.8'

services:
  compute-node:
    build: .
    ports:
      - "4007:4007"   # API
      - "2222:2222"   # SSH
    environment:
      - PRIVATE_KEY=${PRIVATE_KEY}
      - COMPUTE_PORT=4007
      - MODEL_BACKEND=ollama
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      - ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

volumes:
  ollama-data:
```

## Step 5: Register Provider

```bash
# Get hardware attestation
curl http://localhost:4007/v1/hardware > attestation.json

# Register on-chain
cast send $COMPUTE_REGISTRY \
  "register(string,string,uint256)" \
  "https://compute.mynode.com:4007" \
  "$(cat attestation.json | jq -c)" \
  $(cast --to-wei 0.01) \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 6: Verify

```bash
# Test inference
curl http://localhost:4007/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama2",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Check registration
cast call $COMPUTE_REGISTRY "getProviderByAddress(address)" $YOUR_ADDRESS
```

## Pricing

Set your pricing:

```bash
# Update price (per hour in wei)
cast send $COMPUTE_REGISTRY "updatePricing(uint256)" \
  $(cast --to-wei 0.01) \
  --rpc-url $RPC_URL \
  --private-key $PK
```

Recommended pricing: RTX 3090 at 0.005 ETH/hour, A100 at 0.015 ETH/hour, H100 at 0.025 ETH/hour.

## Docker Rentals

Enable container rentals:

```bash
# Allow Docker access
DOCKER_ENABLED=true
```

Users can:
- Start containers
- SSH into containers
- Run arbitrary workloads

## Monitoring

### Health Check

```bash
curl http://localhost:4007/health
```

### Metrics

```bash
# GPU utilization
nvidia-smi --query-gpu=utilization.gpu --format=csv

# Active sessions
curl http://localhost:4007/v1/sessions
```

### Logs

```bash
# Node logs
docker compose logs -f compute-node

# Ollama logs
docker compose logs -f ollama
```

## Earnings

Earnings come from:
- Inference requests (per-token)
- Compute rentals (per-hour)

### Claim Earnings

```bash
# Check balance
cast call $INFERENCE_SERVING "getBalance(address)" $YOUR_ADDRESS

# Withdraw
cast send $INFERENCE_SERVING "withdraw(uint256)" $AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Security

### TEE Support

For higher trust, enable TEE attestation:

```bash
# Intel TDX
TDX_ENABLED=true

# NVIDIA Confidential Computing
CC_ENABLED=true
```

### Firewall

```bash
# Allow only necessary ports
sudo ufw allow 4007/tcp  # API
sudo ufw allow 2222/tcp  # SSH (if enabled)
```

## Maintenance

### Update

```bash
cd jeju
git pull
cd apps/compute
bun install
bun run node
```

### Go Offline

```bash
# Set inactive (keeps stake, stops matching)
cast send $COMPUTE_REGISTRY "setActive(bool)" false \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Unstake

```bash
# Initiate unstake
cast send $COMPUTE_STAKING "initiateUnstake(uint256)" $AMOUNT

# After cooldown
cast send $COMPUTE_STAKING "completeUnstake()"
```

## Troubleshooting

### GPU Not Detected

```bash
# Check NVIDIA driver
nvidia-smi

# Check Docker GPU access
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

### Model Load Fails

```bash
# Check Ollama
ollama list
ollama pull llama2

# Check memory
free -h
```

### Connection Issues

```bash
# Check port is open
curl http://localhost:4007/health

# Check firewall
sudo ufw status
```

