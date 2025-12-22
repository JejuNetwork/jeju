#!/bin/bash
# OAuth3 TEE Agent Setup Script (GCP)

set -euo pipefail

# Get instance metadata
INSTANCE_NAME=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/name" -H "Metadata-Flavor: Google")
ZONE=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/zone" -H "Metadata-Flavor: Google" | cut -d'/' -f4)

# Configure environment
cat > /etc/oauth3.env << EOF
OAUTH3_NODE_ID=$${INSTANCE_NAME}
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

# Pull and run OAuth3 agent (COS has Docker pre-installed)
docker-credential-gcr configure-docker

docker pull ghcr.io/jeju-network/oauth3-agent:${environment}

docker run -d \
  --name oauth3-agent \
  --restart unless-stopped \
  --env-file /etc/oauth3.env \
  -p 4200:4200 \
  -p 4100:4100 \
  ghcr.io/jeju-network/oauth3-agent:${environment}
