#!/bin/bash
# OAuth3 TEE Agent Setup Script (AWS)

set -euo pipefail

# Install Docker
yum update -y
yum install -y docker
systemctl start docker
systemctl enable docker

# Configure environment
cat > /etc/oauth3.env << EOF
OAUTH3_NODE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
OAUTH3_CLUSTER_ID=oauth3-${environment}
OAUTH3_PORT=4200
CHAIN_ID=${chain_id}
JEJU_RPC_URL=${rpc_url}
DWS_URL=${dws_url}
TEE_MODE=${tee_mode}
MPC_ENABLED=true
MPC_THRESHOLD=2
MPC_TOTAL_PARTIES=3
LOG_LEVEL=info
EOF

# Pull and run OAuth3 agent
docker pull ghcr.io/jeju-network/oauth3-agent:${environment}

docker run -d \
  --name oauth3-agent \
  --restart unless-stopped \
  --env-file /etc/oauth3.env \
  -p 4200:4200 \
  -p 4100:4100 \
  ghcr.io/jeju-network/oauth3-agent:${environment}

# Configure Nitro Enclaves if enabled
if [ "${tee_mode}" = "nitro" ]; then
  yum install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
  systemctl start nitro-enclaves-allocator.service
  systemctl enable nitro-enclaves-allocator.service
fi
