#!/bin/bash
#
# Jeju Node - One-Command Installer
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jeju-l3/jeju/main/scripts/install-node.sh | bash
#
# Or:
#   wget -qO- https://raw.githubusercontent.com/jeju-l3/jeju/main/scripts/install-node.sh | bash
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
JEJU_HOME="$HOME/.jeju"
NETWORK="${JEJU_NETWORK:-mainnet}" # mainnet, testnet, or localnet
NODE_TYPE="${JEJU_NODE_TYPE:-full}" # full or archive
SNAPSHOT_ENABLED="${JEJU_SNAPSHOT:-true}"

# URLs
REPO_URL="https://github.com/jeju-l3/jeju"
SNAPSHOT_BASE_URL="https://snapshots.jeju.network"

# ============ Helper Functions ============

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# ============ System Detection ============

detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
            OS_VERSION=$VERSION_ID
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        log_error "Unsupported OS: $OSTYPE"
        exit 1
    fi
    log_info "Detected OS: $OS"
}

# ============ Dependency Installation ============

install_docker() {
    if command_exists docker; then
        log_success "Docker already installed: $(docker --version)"
        return
    fi

    log_info "Installing Docker..."
    
    if [[ "$OS" == "macos" ]]; then
        if command_exists brew; then
            brew install --cask docker
        else
            log_error "Please install Docker Desktop manually from https://docker.com/products/docker-desktop"
            exit 1
        fi
    elif [[ "$OS" == "ubuntu" ]] || [[ "$OS" == "debian" ]]; then
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker $USER
        log_warn "You may need to log out and back in for Docker permissions to take effect"
    elif [[ "$OS" == "centos" ]] || [[ "$OS" == "rhel" ]]; then
        sudo yum install -y docker
        sudo systemctl start docker
        sudo systemctl enable docker
        sudo usermod -aG docker $USER
    else
        log_error "Please install Docker manually from https://docker.com"
        exit 1
    fi
    
    log_success "Docker installed successfully"
}

install_docker_compose() {
    if command_exists docker-compose; then
        log_success "Docker Compose already installed: $(docker-compose --version)"
        return
    fi

    log_info "Installing Docker Compose..."
    
    if [[ "$OS" == "macos" ]]; then
        log_info "Docker Compose comes with Docker Desktop on macOS"
    else
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
            -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi
    
    log_success "Docker Compose installed successfully"
}

# ============ Node Configuration ============

create_directories() {
    log_info "Creating directories..."
    mkdir -p "$JEJU_HOME"/{data,config,logs,backups}
    cd "$JEJU_HOME"
    log_success "Directories created at $JEJU_HOME"
}

generate_jwt_secret() {
    log_info "Generating JWT secret..."
    if command_exists openssl; then
        openssl rand -hex 32 > "$JEJU_HOME/config/jwt-secret.txt"
    else
        # Fallback for systems without openssl
        head -c 32 /dev/urandom | xxd -p -c 32 > "$JEJU_HOME/config/jwt-secret.txt"
    fi
    chmod 600 "$JEJU_HOME/config/jwt-secret.txt"
    log_success "JWT secret generated"
}

download_configs() {
    log_info "Downloading network configurations..."
    
    local config_url="https://raw.githubusercontent.com/jeju-l3/jeju/main/config"
    
    # Download rollup config
    curl -fsSL "$config_url/rollup/${NETWORK}.json" -o "$JEJU_HOME/config/rollup.json" || {
        log_error "Failed to download rollup config for $NETWORK"
        log_info "Trying alternative path..."
        
        # Fallback to local file if available
        if [ -f "$(dirname $0)/../config/rollup/${NETWORK}.json" ]; then
            cp "$(dirname $0)/../config/rollup/${NETWORK}.json" "$JEJU_HOME/config/rollup.json"
            log_success "Copied local rollup config"
        else
            log_error "No rollup config available"
            exit 1
        fi
    }
    
    # Download genesis config (optional)
    curl -fsSL "$config_url/genesis/${NETWORK}.json" -o "$JEJU_HOME/config/genesis.json" || {
        log_warn "Genesis config not found (not needed for RPC nodes)"
    }
    
    log_success "Network configurations downloaded"
}

create_docker_compose() {
    log_info "Creating Docker Compose configuration..."
    
    local pruning_flag="full"
    if [[ "$NODE_TYPE" == "archive" ]]; then
        pruning_flag="archive"
    fi
    
    # Get L1 RPC URL based on network
    local l1_rpc
    case $NETWORK in
        mainnet)
            l1_rpc="https://mainnet.base.org"
            ;;
        testnet)
            l1_rpc="https://sepolia.base.org"
            ;;
        *)
            l1_rpc="http://localhost:8545"
            ;;
    esac
    
    cat > "$JEJU_HOME/docker-compose.yml" <<EOF
version: '3.8'

services:
  reth:
    image: ghcr.io/paradigmxyz/op-reth:v1.0.3
    container_name: jeju-reth
    restart: unless-stopped
    ports:
      - "8545:8545"  # HTTP RPC
      - "8546:8546"  # WebSocket
      - "30303:30303"  # P2P TCP
      - "30303:30303/udp"  # P2P UDP
      - "9001:9001"  # Metrics
    volumes:
      - $JEJU_HOME/data:/data
      - $JEJU_HOME/config/jwt-secret.txt:/secrets/jwt-secret.txt:ro
      - $JEJU_HOME/logs:/logs
    command:
      - op-reth
      - node
      - --chain=optimism
      - --datadir=/data
      - --http
      - --http.addr=0.0.0.0
      - --http.port=8545
      - --http.api=eth,net,web3,txpool,trace,debug
      - --http.corsdomain=*
      - --ws
      - --ws.addr=0.0.0.0
      - --ws.port=8546
      - --ws.api=eth,net,web3,txpool,trace
      - --ws.origins=*
      - --authrpc.addr=0.0.0.0
      - --authrpc.port=8551
      - --authrpc.jwtsecret=/secrets/jwt-secret.txt
      - --port=30303
      - --discovery.port=30303
      - --max-outbound-peers=100
      - --max-inbound-peers=30
      - --metrics=0.0.0.0:9001
      - --pruning=$pruning_flag
      - --log.stdout.format=json
      - --log.file.directory=/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8545"]
      interval: 30s
      timeout: 10s
      retries: 3

  op-node:
    image: us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.7.6
    container_name: jeju-op-node
    restart: unless-stopped
    ports:
      - "9545:9545"  # RPC
      - "9003:9003"  # P2P TCP
      - "9003:9003/udp"  # P2P UDP
      - "7300:7300"  # Metrics
    volumes:
      - $JEJU_HOME/data/op-node:/data
      - $JEJU_HOME/config/jwt-secret.txt:/secrets/jwt-secret.txt:ro
      - $JEJU_HOME/config/rollup.json:/config/rollup.json:ro
    command:
      - op-node
      - --network=${NETWORK}-l3
      - --rollup.config=/config/rollup.json
      - --l1=$l1_rpc
      - --l1.rpckind=basic
      - --l2=http://reth:8551
      - --l2.jwt-secret=/secrets/jwt-secret.txt
      - --rpc.addr=0.0.0.0
      - --rpc.port=9545
      - --p2p.listen.ip=0.0.0.0
      - --p2p.listen.tcp=9003
      - --p2p.listen.udp=9003
      - --metrics.enabled
      - --metrics.addr=0.0.0.0
      - --metrics.port=7300
      - --syncmode=execution-layer
    depends_on:
      reth:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9545"]
      interval: 30s
      timeout: 10s
      retries: 3

  node-exporter:
    image: prom/node-exporter:latest
    container_name: jeju-node-exporter
    restart: unless-stopped
    ports:
      - "9100:9100"
    command:
      - '--path.rootfs=/host'
    volumes:
      - '/:/host:ro,rslave'

  prometheus:
    image: prom/prometheus:latest
    container_name: jeju-prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - $JEJU_HOME/config/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - $JEJU_HOME/data/prometheus:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

networks:
  default:
    name: jeju-network
EOF

    log_success "Docker Compose configuration created"
}

create_prometheus_config() {
    log_info "Creating Prometheus configuration..."
    
    cat > "$JEJU_HOME/config/prometheus.yml" <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'reth'
    static_configs:
      - targets: ['reth:9001']
        labels:
          instance: 'jeju-reth'

  - job_name: 'op-node'
    static_configs:
      - targets: ['op-node:7300']
        labels:
          instance: 'jeju-op-node'

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
        labels:
          instance: 'jeju-host'
EOF

    log_success "Prometheus configuration created"
}

download_snapshot() {
    if [[ "$SNAPSHOT_ENABLED" != "true" ]]; then
        log_info "Snapshot download disabled, will sync from genesis"
        return
    fi

    log_info "Checking for available snapshots..."
    
    local snapshot_url="$SNAPSHOT_BASE_URL/${NETWORK}-${NODE_TYPE}-latest.tar.gz"
    local snapshot_file="$JEJU_HOME/snapshot.tar.gz"
    
    # Check if snapshot exists
    if curl -fsSL --head "$snapshot_url" >/dev/null 2>&1; then
        log_info "Downloading snapshot (this may take a while)..."
        log_info "Snapshot URL: $snapshot_url"
        
        if command_exists wget; then
            wget -q --show-progress "$snapshot_url" -O "$snapshot_file" || {
                log_warn "Snapshot download failed, will sync from genesis"
                return
            }
        else
            curl -# -L "$snapshot_url" -o "$snapshot_file" || {
                log_warn "Snapshot download failed, will sync from genesis"
                return
            }
        fi
        
        log_info "Extracting snapshot to $JEJU_HOME/data..."
        mkdir -p "$JEJU_HOME/data"
        tar -xzf "$snapshot_file" -C "$JEJU_HOME/data" || {
            log_error "Failed to extract snapshot"
            rm -f "$snapshot_file"
            return 1
        }
        
        rm -f "$snapshot_file"
        log_success "Snapshot downloaded and extracted successfully"
    else
        log_warn "No snapshot available for $NETWORK ($NODE_TYPE)"
        log_info "Will sync from genesis (this may take 3-7 days)"
        log_info ""
        log_info "To speed up sync, you can:"
        log_info "  1. Run the snapshot download script manually later"
        log_info "  2. Or wait for snapshots to become available"
    fi
}

create_systemd_service() {
    if [[ "$OS" == "macos" ]]; then
        log_info "Skipping systemd service (macOS uses launchd)"
        return
    fi
    
    log_info "Creating systemd service..."
    
    sudo tee /etc/systemd/system/jeju-node.service >/dev/null <<EOF
[Unit]
Description=Jeju Node
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$JEJU_HOME
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=$USER

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable jeju-node
    
    log_success "Systemd service created and enabled"
}

create_helper_scripts() {
    log_info "Creating helper scripts..."
    
    # Status script
    cat > "$JEJU_HOME/status.sh" <<'EOF'
#!/bin/bash
cd ~/.jeju
echo "=== Jeju Node Status ==="
docker-compose ps
echo ""
echo "=== Sync Status ==="
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}' | jq .
echo ""
echo "=== Latest Block ==="
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq .
EOF

    # Logs script
    cat > "$JEJU_HOME/logs.sh" <<'EOF'
#!/bin/bash
cd ~/.jeju
docker-compose logs -f --tail=100 "$@"
EOF

    # Stop script
    cat > "$JEJU_HOME/stop.sh" <<'EOF'
#!/bin/bash
cd ~/.jeju
docker-compose down
EOF

    # Start script
    cat > "$JEJU_HOME/start.sh" <<'EOF'
#!/bin/bash
cd ~/.jeju
docker-compose up -d
EOF

    # Update script
    cat > "$JEJU_HOME/update.sh" <<'EOF'
#!/bin/bash
cd ~/.jeju
echo "Pulling latest images..."
docker-compose pull
echo "Restarting services..."
docker-compose up -d
echo "Update complete!"
EOF

    chmod +x "$JEJU_HOME"/*.sh
    
    log_success "Helper scripts created"
}

# ============ Main Installation Flow ============

main() {
    echo ""
    echo "╔═══════════════════════════════════════╗"
    echo "║   Jeju Node - One-Click Installer ║"
    echo "╚═══════════════════════════════════════╝"
    echo ""
    
    log_info "Network: $NETWORK"
    log_info "Node Type: $NODE_TYPE"
    log_info "Snapshot: $SNAPSHOT_ENABLED"
    echo ""
    
    # Detect system
    detect_os
    
    # Install dependencies
    install_docker
    install_docker_compose
    
    # Setup node
    create_directories
    generate_jwt_secret
    download_configs
    create_docker_compose
    create_prometheus_config
    download_snapshot
    create_systemd_service
    create_helper_scripts
    
    echo ""
    log_success "Installation complete! 🎉"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start your node:"
    echo "   cd $JEJU_HOME && docker-compose up -d"
    echo ""
    echo "2. Check status:"
    echo "   $JEJU_HOME/status.sh"
    echo ""
    echo "3. View logs:"
    echo "   $JEJU_HOME/logs.sh"
    echo ""
    echo "4. Monitor metrics:"
    echo "   Prometheus: http://localhost:9090"
    echo ""
    echo "RPC Endpoints:"
    echo "   HTTP: http://localhost:8545"
    echo "   WebSocket: ws://localhost:8546"
    echo ""
    echo "For help and support:"
    echo "   Docs: https://docs.jeju.network"
    echo "   Discord: https://discord.gg/jeju"
    echo ""
    
    # Auto-start if requested
    if [[ "${JEJU_AUTOSTART:-false}" == "true" ]]; then
        log_info "Auto-starting node..."
        cd "$JEJU_HOME" && docker-compose up -d
        sleep 5
        "$JEJU_HOME/status.sh"
    fi
}

# Run installer
main "$@"

