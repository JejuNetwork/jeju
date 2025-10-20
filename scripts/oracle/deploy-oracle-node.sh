#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Jeju Oracle Node Deployment Script
################################################################################
#
# This script deploys and configures a Jeju oracle price updater node with:
# - Dstack TEE attestation support
# - Multi-cloud compatibility (AWS, Hetzner, GCP, Azure, etc.)
# - Systemd service installation
# - Health check endpoints
# - Prometheus monitoring integration
# - Security hardening
# - Automatic failover configuration
#
# Usage:
#   ./deploy-oracle-node.sh [OPTIONS]
#
# Options:
#   --env-file PATH         Path to environment configuration file (default: .env.oracle)
#   --bot-id ID             Unique identifier for this bot instance
#   --cloud-provider NAME   Cloud provider: aws, hetzner, gcp, azure, other (default: other)
#   --enable-tee            Enable Dstack TEE attestation (default: false)
#   --skip-firewall         Skip firewall configuration (default: false)
#   --skip-monitoring       Skip monitoring agent installation (default: false)
#   --skip-service          Skip systemd service installation (default: false)
#   --help                  Show this help message
#
# Environment Variables Required (.env.oracle):
#   BASE_RPC_URLS              Comma-separated Base RPC endpoints
#   JEJU_RPC_URLS              Comma-separated Jeju RPC endpoints
#   ORACLE_ADDRESS             Oracle contract address on Jeju
#   ELIZAOS_TOKEN_BASE         ElizaOS token address on Base
#   PRICE_UPDATER_PRIVATE_KEY  Private key for oracle updates (keep secure!)
#   BOT_ID                     Unique bot identifier (auto-generated if not set)
#   HEALTH_CHECK_PORT          Health check HTTP port (default: 3000)
#
# Optional Environment Variables:
#   TELEGRAM_BOT_TOKEN         Telegram bot token for alerts
#   TELEGRAM_CHAT_ID           Telegram chat ID for alerts
#   DISCORD_WEBHOOK_URL        Discord webhook URL for alerts
#   DSTACK_API_KEY             Dstack TEE API key (if using TEE)
#   PROMETHEUS_PUSHGATEWAY     Prometheus pushgateway URL
#
# Examples:
#   # Basic deployment
#   ./deploy-oracle-node.sh --env-file .env.oracle
#
#   # AWS deployment with TEE
#   ./deploy-oracle-node.sh --cloud-provider aws --enable-tee --bot-id bot-aws-1
#
#   # Hetzner deployment without monitoring
#   ./deploy-oracle-node.sh --cloud-provider hetzner --skip-monitoring --bot-id bot-hetzner-1
#
################################################################################

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default values
ENV_FILE="${ENV_FILE:-.env.oracle}"
BOT_ID="${BOT_ID:-bot-$(hostname)-$(date +%s)}"
CLOUD_PROVIDER="${CLOUD_PROVIDER:-other}"
ENABLE_TEE="${ENABLE_TEE:-false}"
SKIP_FIREWALL="${SKIP_FIREWALL:-false}"
SKIP_MONITORING="${SKIP_MONITORING:-false}"
SKIP_SERVICE="${SKIP_SERVICE:-false}"
HEALTH_CHECK_PORT="${HEALTH_CHECK_PORT:-3000}"

# Installation paths
INSTALL_DIR="/opt/jeju-oracle"
SERVICE_NAME="jeju-oracle"
SERVICE_USER="jeju-oracle"
LOG_DIR="/var/log/jeju-oracle"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    sed -n '/^# Usage:/,/^################################################################################$/p' "$0" | sed 's/^# \?//'
    exit 0
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_dependencies() {
    log_info "Checking system dependencies..."

    local missing_deps=()

    # Required commands
    for cmd in curl wget git jq systemctl ufw; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Install with: apt-get install -y ${missing_deps[*]} (Debian/Ubuntu)"
        log_info "           or: yum install -y ${missing_deps[*]} (RHEL/CentOS)"
        exit 1
    fi

    # Check for Bun runtime
    if ! command -v bun &> /dev/null; then
        log_warning "Bun runtime not found. Installing..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    log_success "All dependencies satisfied"
}

detect_cloud_provider() {
    if [[ "$CLOUD_PROVIDER" != "other" ]]; then
        return
    fi

    log_info "Detecting cloud provider..."

    # AWS detection
    if curl -s -f -m 1 http://169.254.169.254/latest/meta-data/ &>/dev/null; then
        CLOUD_PROVIDER="aws"
        log_info "Detected AWS environment"
        return
    fi

    # Hetzner detection
    if curl -s -f -m 1 http://169.254.169.254/hetzner/v1/metadata &>/dev/null; then
        CLOUD_PROVIDER="hetzner"
        log_info "Detected Hetzner environment"
        return
    fi

    # GCP detection
    if curl -s -f -m 1 -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/ &>/dev/null; then
        CLOUD_PROVIDER="gcp"
        log_info "Detected GCP environment"
        return
    fi

    # Azure detection
    if curl -s -f -m 1 -H "Metadata: true" http://169.254.169.254/metadata/instance?api-version=2021-02-01 &>/dev/null; then
        CLOUD_PROVIDER="azure"
        log_info "Detected Azure environment"
        return
    fi

    log_warning "Could not detect cloud provider, using 'other'"
}

# ============================================================================
# Installation Functions
# ============================================================================

install_bun() {
    log_info "Installing Bun runtime..."

    if command -v bun &> /dev/null; then
        log_info "Bun already installed: $(bun --version)"
        return
    fi

    curl -fsSL https://bun.sh/install | bash

    # Make available system-wide
    if [[ -f "$HOME/.bun/bin/bun" ]]; then
        ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
    fi

    log_success "Bun runtime installed"
}

install_dstack_sdk() {
    if [[ "$ENABLE_TEE" != "true" ]]; then
        return
    fi

    log_info "Installing Dstack TEE SDK..."

    # Install Dstack TEE dependencies
    cd "$INSTALL_DIR"

    # Add Dstack SDK to package.json if not exists
    if ! grep -q '"@dstack/sdk"' package.json 2>/dev/null; then
        bun add @dstack/sdk
    fi

    log_success "Dstack TEE SDK installed"
}

create_service_user() {
    log_info "Creating service user..."

    if id "$SERVICE_USER" &>/dev/null; then
        log_info "Service user '$SERVICE_USER' already exists"
        return
    fi

    useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
    log_success "Service user '$SERVICE_USER' created"
}

setup_installation_directory() {
    log_info "Setting up installation directory..."

    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LOG_DIR"

    # Copy project files
    log_info "Copying project files..."
    cp -r "$PROJECT_ROOT/package.json" "$INSTALL_DIR/"
    cp -r "$PROJECT_ROOT/bun.lock" "$INSTALL_DIR/" 2>/dev/null || true
    cp -r "$PROJECT_ROOT/scripts" "$INSTALL_DIR/"
    cp -r "$PROJECT_ROOT/contracts" "$INSTALL_DIR/" 2>/dev/null || true

    # Install dependencies
    cd "$INSTALL_DIR"
    log_info "Installing Node dependencies..."
    bun install --production

    # Set permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"

    log_success "Installation directory configured"
}

setup_environment() {
    log_info "Configuring environment..."

    # Check if env file exists
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "Environment file not found: $ENV_FILE"
        log_info "Create one with required variables (see --help)"
        exit 1
    fi

    # Copy environment file
    cp "$ENV_FILE" "$INSTALL_DIR/.env"

    # Add BOT_ID if not set
    if ! grep -q "^BOT_ID=" "$INSTALL_DIR/.env"; then
        echo "BOT_ID=$BOT_ID" >> "$INSTALL_DIR/.env"
    fi

    # Add LEADER_ELECTION_ENABLED
    if ! grep -q "^LEADER_ELECTION_ENABLED=" "$INSTALL_DIR/.env"; then
        echo "LEADER_ELECTION_ENABLED=true" >> "$INSTALL_DIR/.env"
    fi

    # Add HEALTH_CHECK_PORT
    if ! grep -q "^HEALTH_CHECK_PORT=" "$INSTALL_DIR/.env"; then
        echo "HEALTH_CHECK_PORT=$HEALTH_CHECK_PORT" >> "$INSTALL_DIR/.env"
    fi

    # Add cloud provider metadata
    echo "CLOUD_PROVIDER=$CLOUD_PROVIDER" >> "$INSTALL_DIR/.env"

    # Secure the env file
    chmod 600 "$INSTALL_DIR/.env"
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"

    log_success "Environment configured"
}

configure_firewall() {
    if [[ "$SKIP_FIREWALL" == "true" ]]; then
        log_info "Skipping firewall configuration"
        return
    fi

    log_info "Configuring firewall..."

    # Enable ufw if not enabled
    if ! ufw status | grep -q "Status: active"; then
        log_warning "UFW is not active. Enabling with default deny incoming..."
        ufw --force enable
    fi

    # Allow SSH (important!)
    ufw allow 22/tcp comment 'SSH'

    # Allow health check port
    ufw allow "$HEALTH_CHECK_PORT/tcp" comment 'Oracle health check'

    # Allow Prometheus metrics scraping (if configured)
    if [[ -n "${PROMETHEUS_PORT:-}" ]]; then
        ufw allow "$PROMETHEUS_PORT/tcp" comment 'Prometheus metrics'
    fi

    # Deny all other incoming by default
    ufw default deny incoming
    ufw default allow outgoing

    log_success "Firewall configured"
}

install_systemd_service() {
    if [[ "$SKIP_SERVICE" == "true" ]]; then
        log_info "Skipping systemd service installation"
        return
    fi

    log_info "Installing systemd service..."

    # Create systemd service file
    cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Jeju Oracle Price Updater Bot
Documentation=https://github.com/jeju-network/jeju
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/local/bin/bun run $INSTALL_DIR/scripts/oracle-updater.ts
Restart=always
RestartSec=10
StartLimitInterval=0
StartLimitBurst=5

# Environment
EnvironmentFile=$INSTALL_DIR/.env

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$LOG_DIR /tmp

# Resource limits
LimitNOFILE=65536
MemoryMax=512M
CPUQuota=50%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd
    systemctl daemon-reload

    # Enable service
    systemctl enable "$SERVICE_NAME"

    log_success "Systemd service installed"
}

install_monitoring_agent() {
    if [[ "$SKIP_MONITORING" == "true" ]]; then
        log_info "Skipping monitoring agent installation"
        return
    fi

    log_info "Installing monitoring agents..."

    # Install node_exporter for system metrics
    if ! command -v node_exporter &> /dev/null; then
        log_info "Installing node_exporter..."

        local version="1.7.0"
        cd /tmp
        wget -q "https://github.com/prometheus/node_exporter/releases/download/v${version}/node_exporter-${version}.linux-amd64.tar.gz"
        tar xzf "node_exporter-${version}.linux-amd64.tar.gz"
        mv "node_exporter-${version}.linux-amd64/node_exporter" /usr/local/bin/
        rm -rf "node_exporter-${version}.linux-amd64"*

        # Create node_exporter service
        cat > /etc/systemd/system/node_exporter.service <<EOF
[Unit]
Description=Node Exporter
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF

        systemctl daemon-reload
        systemctl enable node_exporter
        systemctl start node_exporter

        log_success "node_exporter installed"
    fi

    # Configure log rotation
    cat > /etc/logrotate.d/jeju-oracle <<EOF
$LOG_DIR/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 $SERVICE_USER $SERVICE_USER
    sharedscripts
    postrotate
        systemctl reload $SERVICE_NAME > /dev/null 2>&1 || true
    endscript
}
EOF

    log_success "Monitoring agents installed"
}

setup_health_checks() {
    log_info "Setting up health checks..."

    # Create health check script
    cat > "$INSTALL_DIR/health-check.sh" <<'EOF'
#!/bin/bash
HEALTH_PORT=${HEALTH_CHECK_PORT:-3000}
HEALTH_URL="http://localhost:${HEALTH_PORT}/health"

response=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL")

if [[ "$response" == "200" ]]; then
    echo "OK: Oracle bot is healthy"
    exit 0
else
    echo "CRITICAL: Oracle bot health check failed (HTTP $response)"
    exit 2
fi
EOF

    chmod +x "$INSTALL_DIR/health-check.sh"
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/health-check.sh"

    log_success "Health checks configured"
}

configure_tee_attestation() {
    if [[ "$ENABLE_TEE" != "true" ]]; then
        return
    fi

    log_info "Configuring Dstack TEE attestation..."

    # Check if running in TEE environment
    if [[ ! -d /dev/tee ]]; then
        log_warning "TEE device not found. Make sure you're running on TEE-enabled hardware"
    fi

    # Add TEE configuration to environment
    if [[ -n "${DSTACK_API_KEY:-}" ]]; then
        echo "DSTACK_API_KEY=$DSTACK_API_KEY" >> "$INSTALL_DIR/.env"
        echo "ENABLE_TEE_ATTESTATION=true" >> "$INSTALL_DIR/.env"
    else
        log_warning "DSTACK_API_KEY not set. TEE attestation will not be enabled"
    fi

    log_success "TEE attestation configured"
}

apply_security_hardening() {
    log_info "Applying security hardening..."

    # Disable SSH password authentication (key-only)
    if grep -q "^PasswordAuthentication yes" /etc/ssh/sshd_config; then
        log_info "Disabling SSH password authentication..."
        sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
        systemctl reload sshd
    fi

    # Install fail2ban if not present
    if ! command -v fail2ban-client &> /dev/null; then
        log_info "Installing fail2ban..."
        apt-get update -qq && apt-get install -y fail2ban
        systemctl enable fail2ban
        systemctl start fail2ban
    fi

    # Configure automatic security updates
    if ! command -v unattended-upgrade &> /dev/null; then
        log_info "Installing unattended-upgrades..."
        apt-get update -qq && apt-get install -y unattended-upgrades
        dpkg-reconfigure -plow unattended-upgrades
    fi

    log_success "Security hardening applied"
}

# ============================================================================
# Main Installation Flow
# ============================================================================

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --env-file)
                ENV_FILE="$2"
                shift 2
                ;;
            --bot-id)
                BOT_ID="$2"
                shift 2
                ;;
            --cloud-provider)
                CLOUD_PROVIDER="$2"
                shift 2
                ;;
            --enable-tee)
                ENABLE_TEE=true
                shift
                ;;
            --skip-firewall)
                SKIP_FIREWALL=true
                shift
                ;;
            --skip-monitoring)
                SKIP_MONITORING=true
                shift
                ;;
            --skip-service)
                SKIP_SERVICE=true
                shift
                ;;
            --help)
                show_help
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                ;;
        esac
    done

    # Display banner
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║        Jeju Oracle Node Deployment Script                 ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""

    # Run installation steps
    check_root
    check_dependencies
    detect_cloud_provider

    log_info "Deployment configuration:"
    log_info "  Bot ID: $BOT_ID"
    log_info "  Cloud Provider: $CLOUD_PROVIDER"
    log_info "  TEE Enabled: $ENABLE_TEE"
    log_info "  Install Dir: $INSTALL_DIR"
    log_info "  Health Check Port: $HEALTH_CHECK_PORT"
    echo ""

    install_bun
    create_service_user
    setup_installation_directory
    setup_environment
    install_dstack_sdk
    configure_tee_attestation
    configure_firewall
    install_monitoring_agent
    setup_health_checks
    install_systemd_service
    apply_security_hardening

    echo ""
    log_success "Oracle node deployment completed!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Start the service:"
    echo "     sudo systemctl start $SERVICE_NAME"
    echo ""
    echo "  2. Check service status:"
    echo "     sudo systemctl status $SERVICE_NAME"
    echo ""
    echo "  3. View logs:"
    echo "     sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "  4. Check health:"
    echo "     curl http://localhost:$HEALTH_CHECK_PORT/health"
    echo ""
    echo "  5. View metrics:"
    echo "     curl http://localhost:$HEALTH_CHECK_PORT/metrics"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Run main function
main "$@"
