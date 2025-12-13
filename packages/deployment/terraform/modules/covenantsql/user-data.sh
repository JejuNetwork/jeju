#!/bin/bash
set -e

# CovenantSQL Node Setup Script
# Environment: ${environment}
# Node Count: ${node_count}

echo "Starting CovenantSQL node setup..."

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
  mkdir -p /data/covenantsql
  mount /dev/xvdf /data/covenantsql
  echo '/dev/xvdf /data/covenantsql xfs defaults,nofail 0 2' >> /etc/fstab
fi

# Get instance metadata
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
AZ=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone)
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
  --filters "Name=tag:Component,Values=covenantsql" "Name=tag:Environment,Values=${environment}" "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].PrivateIpAddress' --output text | tr '\t' ',')

# Create CovenantSQL config directory
mkdir -p /data/covenantsql/config
mkdir -p /data/covenantsql/data

# Generate node config
cat > /data/covenantsql/config/config.yaml << EOF
# CovenantSQL Node Configuration
# Generated for ${environment} environment

IsTestNet: $([ "${environment}" == "testnet" ] && echo "true" || echo "false")

WorkingRoot: /data/covenantsql/data

ThisNodeID: node-$NODE_INDEX

PubKeyStoreFile: /data/covenantsql/config/public.keystore
PrivateKeyFile: /data/covenantsql/config/private.key

ListenAddr: "0.0.0.0:4661"
ExternalAddr: "$PRIVATE_IP:4661"

KayakAddr: "0.0.0.0:4663"
Kayak:
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
  Output: /data/covenantsql/logs/node.log

# Metrics
Metrics:
  Enabled: true
  Addr: "0.0.0.0:9100"
EOF

# Write private key
echo "$PRIVATE_KEY" > /data/covenantsql/config/private.key
chmod 600 /data/covenantsql/config/private.key

# Create logs directory
mkdir -p /data/covenantsql/logs

# Pull and run CovenantSQL container
docker pull covenantsql/covenantsql:latest

# Create systemd service for CovenantSQL
cat > /etc/systemd/system/covenantsql.service << EOF
[Unit]
Description=CovenantSQL Node
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop covenantsql
ExecStartPre=-/usr/bin/docker rm covenantsql
ExecStart=/usr/bin/docker run --name covenantsql \
  -p 4661:4661 \
  -p 4662:4662 \
  -p 4663:4663 \
  -p 8546:8546 \
  -p 9100:9100 \
  -v /data/covenantsql/config:/config:ro \
  -v /data/covenantsql/data:/data \
  -v /data/covenantsql/logs:/logs \
  covenantsql/covenantsql:latest \
  -config /config/config.yaml
ExecStop=/usr/bin/docker stop covenantsql

[Install]
WantedBy=multi-user.target
EOF

# Start CovenantSQL service
systemctl daemon-reload
systemctl enable covenantsql
systemctl start covenantsql

# Install CloudWatch agent for log shipping
yum install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/data/covenantsql/logs/node.log",
            "log_group_name": "/jeju/covenantsql/${environment}",
            "log_stream_name": "node-$NODE_INDEX",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "Jeju/CovenantSQL",
    "metrics_collected": {
      "cpu": {
        "resources": ["*"],
        "measurement": ["cpu_usage_idle", "cpu_usage_user", "cpu_usage_system"]
      },
      "disk": {
        "resources": ["/", "/data/covenantsql"],
        "measurement": ["disk_used_percent", "disk_free"]
      },
      "mem": {
        "measurement": ["mem_used_percent", "mem_available"]
      }
    },
    "append_dimensions": {
      "InstanceId": "$INSTANCE_ID",
      "NodeIndex": "$NODE_INDEX",
      "Environment": "${environment}"
    }
  }
}
EOF

systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "CovenantSQL node setup complete."
echo "Node: $NODE_INDEX"
echo "IP: $PRIVATE_IP"
echo "Client Port: 4661"
echo "HTTP API: 8546"

