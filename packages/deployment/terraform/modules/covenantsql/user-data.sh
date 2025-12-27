#!/bin/bash
set -e

# EQLite Node Setup Script
# Environment: ${environment}
# Node Count: ${node_count}
# Architecture: ${architecture}
# Image: ${eqlite_image}

echo "Starting EQLite node setup..."
echo "Architecture: ${architecture}"

# Install dependencies
yum update -y
yum install -y docker jq aws-cli

# Start Docker
systemctl start docker
systemctl enable docker

# Format and mount data volume
if [ -b /dev/xvdf ]; then
  # Check if volume is already formatted
  if ! file -s /dev/xvdf | grep -q 'filesystem'; then
    mkfs.xfs /dev/xvdf
  fi
  mkdir -p /data/eqlite
  mount /dev/xvdf /data/eqlite
  echo '/dev/xvdf /data/eqlite xfs defaults,nofail 0 2' >> /etc/fstab
fi

# Get instance metadata (IMDSv2)
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
REGION=$(echo $AZ | sed 's/[a-z]$//')

# Get node index from tags
NODE_INDEX=$(aws ec2 describe-tags --region $REGION \
  --filters "Name=resource-id,Values=$INSTANCE_ID" "Name=key,Values=NodeIndex" \
  --query 'Tags[0].Value' --output text)

echo "Node Index: $NODE_INDEX"

# Get private key from SSM
PRIVATE_KEY=$(aws ssm get-parameter --region $REGION \
  --name "${private_key_ssm_param}" \
  --with-decryption --query 'Parameter.Value' --output text)

# Get all node IPs for cluster discovery
ALL_NODES=$(aws ec2 describe-instances --region $REGION \
  --filters "Name=tag:Component,Values=eqlite" "Name=tag:Environment,Values=${environment}" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].PrivateIpAddress' --output text | tr '\t' ',')

# Create EQLite config directory
mkdir -p /data/eqlite/config
mkdir -p /data/eqlite/data

# Generate node config
cat > /data/eqlite/config/config.yaml << EOF
# EQLite Node Configuration
# Generated for ${environment} environment
# Architecture: ${architecture}

IsTestNet: $([ "${environment}" == "testnet" ] && echo "true" || echo "false")

WorkingRoot: /data/eqlite/data

ThisNodeID: node-$NODE_INDEX

PubKeyStoreFile: /data/eqlite/config/public.keystore
PrivateKeyFile: /data/eqlite/config/private.key

ListenAddr: "0.0.0.0:4661"
ExternalAddr: "$PRIVATE_IP:4661"

BftRaftAddr: "0.0.0.0:4663"
BftRaft:
  NumOfTicksPerElection: 10
  NumOfTicksPerHeartBeat: 1
  TickTimeout: 100ms

# HTTP API for health checks and queries
APIAddr: "0.0.0.0:8546"

# Block producer settings
BlockProducer:
  Difficulty: 4
  TargetTime: 10s

# Database settings
Database:
  # Enable strong consistency by default
  DefaultConsistency: Strong
  # Cache settings
  CacheSize: 1073741824  # 1GB
  # Write-ahead log
  WALMode: true
  WALSize: 134217728  # 128MB

# Network settings
Network:
  # Initial seed nodes
  SeedNodes:
$(echo "$ALL_NODES" | tr ',' '\n' | while read ip; do echo "    - \"$ip:4662\""; done)

  # Connection settings
  MaxPeers: 50
  ConnTimeout: 30s
  PingInterval: 10s

# Logging
Logging:
  Level: info
  Format: json
  Output: /data/eqlite/logs/node.log

# Metrics
Metrics:
  Enabled: true
  Addr: "0.0.0.0:9100"
EOF

# Write private key
echo "$PRIVATE_KEY" > /data/eqlite/config/private.key
chmod 600 /data/eqlite/config/private.key

# Create logs directory
mkdir -p /data/eqlite/logs

# Pull the EQLite image (supports ARM64 and x86_64)
EQLITE_IMAGE="${eqlite_image}"
echo "Pulling EQLite image: $EQLITE_IMAGE"
docker pull $EQLITE_IMAGE

# Create systemd service for EQLite
cat > /etc/systemd/system/eqlite.service << EOF
[Unit]
Description=EQLite Node
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop eqlite
ExecStartPre=-/usr/bin/docker rm eqlite
ExecStart=/usr/bin/docker run --name eqlite \
  -p 4661:4661 \
  -p 4662:4662 \
  -p 4663:4663 \
  -p 8546:8546 \
  -p 9100:9100 \
  -v /data/eqlite/config:/config:ro \
  -v /data/eqlite/data:/data \
  -v /data/eqlite/logs:/logs \
  $EQLITE_IMAGE \
  -config /config/config.yaml
ExecStop=/usr/bin/docker stop eqlite

[Install]
WantedBy=multi-user.target
EOF

# Start EQLite service
systemctl daemon-reload
systemctl enable eqlite
systemctl start eqlite

# Install CloudWatch agent for log shipping
yum install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/data/eqlite/logs/node.log",
            "log_group_name": "/jeju/eqlite/${environment}",
            "log_stream_name": "node-$NODE_INDEX",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "Jeju/EQLite",
    "metrics_collected": {
      "cpu": {
        "resources": ["*"],
        "measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"]
      },
      "disk": {
        "resources": ["/", "/data/eqlite"],
        "measurement": ["disk_used_percent", "disk_free"]
      },
      "mem": {
        "measurement": ["mem_used_percent", "mem_available"]
      }
    },
    "append_dimensions": {
      "InstanceId": "$INSTANCE_ID",
      "NodeIndex": "$NODE_INDEX",
      "Environment": "${environment}",
      "Architecture": "${architecture}"
    }
  }
}
EOF

systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "EQLite node setup complete."
echo "Node: $NODE_INDEX"
echo "IP: $PRIVATE_IP"
echo "Architecture: ${architecture}"
echo "Image: $EQLITE_IMAGE"
echo "Client Port: 4661"
echo "HTTP API: 8546"
