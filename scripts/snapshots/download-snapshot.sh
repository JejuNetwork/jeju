#!/bin/bash
#
# Download and apply Jeju node snapshot
#
# Usage:
#   ./download-snapshot.sh [network] [node-type]
#   ./download-snapshot.sh mainnet full
#   ./download-snapshot.sh testnet archive
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
NETWORK="${1:-mainnet}"
NODE_TYPE="${2:-full}"
SNAPSHOT_BASE_URL="${SNAPSHOT_BASE_URL:-https://snapshots.jeju.network}"
DATA_DIR="${DATA_DIR:-$HOME/.jeju/data}"
TEMP_DIR="${TEMP_DIR:-/tmp/jeju-snapshot}"

# ============ Functions ============

check_disk_space() {
    log_info "Checking disk space..."
    
    local required_gb=500
    if [[ "$NODE_TYPE" == "archive" ]]; then
        required_gb=2000
    fi
    
    local available_gb=$(df -BG "$DATA_DIR" | tail -1 | awk '{print $4}' | sed 's/G//')
    
    if [[ $available_gb -lt $required_gb ]]; then
        log_error "Insufficient disk space. Required: ${required_gb}GB, Available: ${available_gb}GB"
        exit 1
    fi
    
    log_success "Disk space OK (${available_gb}GB available)"
}

fetch_metadata() {
    log_info "Fetching snapshot metadata..."
    
    local metadata_url="$SNAPSHOT_BASE_URL/${NETWORK}-${NODE_TYPE}-latest.json"
    
    if ! curl -fsSL "$metadata_url" -o "$TEMP_DIR/metadata.json"; then
        log_error "Failed to fetch metadata from $metadata_url"
        exit 1
    fi
    
    # Parse metadata
    SNAPSHOT_URL=$(jq -r '.downloadUrl' "$TEMP_DIR/metadata.json")
    SNAPSHOT_SIZE=$(jq -r '.sizeFormatted' "$TEMP_DIR/metadata.json")
    SNAPSHOT_BLOCK=$(jq -r '.blockNumber' "$TEMP_DIR/metadata.json")
    SNAPSHOT_DATE=$(jq -r '.timestamp' "$TEMP_DIR/metadata.json")
    
    log_success "Snapshot found!"
    echo "   Block: $SNAPSHOT_BLOCK"
    echo "   Size: $SNAPSHOT_SIZE"
    echo "   Date: $SNAPSHOT_DATE"
}

download_snapshot() {
    log_info "Downloading snapshot (this may take a while)..."
    
    mkdir -p "$TEMP_DIR"
    local snapshot_file="$TEMP_DIR/snapshot.tar.gz"
    
    # Use wget with progress bar if available, otherwise curl
    if command -v wget >/dev/null 2>&1; then
        wget -q --show-progress "$SNAPSHOT_URL" -O "$snapshot_file"
    else
        curl -# -L "$SNAPSHOT_URL" -o "$snapshot_file"
    fi
    
    log_success "Download complete!"
    
    # Verify file
    if [[ ! -f "$snapshot_file" ]]; then
        log_error "Snapshot file not found after download"
        exit 1
    fi
    
    local actual_size=$(stat -f%z "$snapshot_file" 2>/dev/null || stat -c%s "$snapshot_file")
    log_info "Downloaded: $(numfmt --to=iec --suffix=B $actual_size)"
}

extract_snapshot() {
    log_info "Extracting snapshot to $DATA_DIR..."
    
    # Backup existing data if it exists
    if [[ -d "$DATA_DIR" ]] && [[ -n "$(ls -A $DATA_DIR)" ]]; then
        log_warn "Existing data found, creating backup..."
        local backup_dir="$DATA_DIR.backup.$(date +%Y%m%d_%H%M%S)"
        mv "$DATA_DIR" "$backup_dir"
        log_info "Backup created at $backup_dir"
        mkdir -p "$DATA_DIR"
    fi
    
    # Extract with progress
    log_info "Extracting (this will take several minutes)..."
    
    if command -v pv >/dev/null 2>&1; then
        # With progress bar
        pv "$TEMP_DIR/snapshot.tar.gz" | tar -xzf - -C "$DATA_DIR"
    else
        # Without progress bar
        tar -xzf "$TEMP_DIR/snapshot.tar.gz" -C "$DATA_DIR"
    fi
    
    log_success "Extraction complete!"
}

cleanup() {
    log_info "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    log_success "Cleanup complete"
}

verify_extraction() {
    log_info "Verifying extracted data..."
    
    if [[ ! -d "$DATA_DIR/db" ]]; then
        log_error "Database directory not found. Extraction may have failed."
        exit 1
    fi
    
    local data_size=$(du -sh "$DATA_DIR" | cut -f1)
    log_success "Data verified (${data_size})"
}

# ============ Main ============

main() {
    echo ""
    echo "╔════════════════════════════════════╗"
    echo "║  Jeju Snapshot Download & Extract  ║"
    echo "╚════════════════════════════════════╝"
    echo ""
    echo "Network: $NETWORK"
    echo "Node Type: $NODE_TYPE"
    echo "Data Dir: $DATA_DIR"
    echo ""
    
    # Check prerequisites
    if ! command -v jq >/dev/null 2>&1; then
        log_error "jq is required but not installed. Please install jq."
        exit 1
    fi
    
    # Create temp directory
    mkdir -p "$TEMP_DIR"
    
    # Run steps
    check_disk_space
    fetch_metadata
    
    # Confirm with user
    read -p "Continue with download? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Download cancelled"
        exit 0
    fi
    
    download_snapshot
    extract_snapshot
    verify_extraction
    cleanup
    
    echo ""
    log_success "Snapshot applied successfully! 🎉"
    echo ""
    echo "Your node will start syncing from block $SNAPSHOT_BLOCK"
    echo ""
    echo "Next steps:"
    echo "  1. Start your node: cd ~/.jeju && docker-compose up -d"
    echo "  2. Monitor sync: ~/.jeju/status.sh"
    echo "  3. View logs: ~/.jeju/logs.sh"
    echo ""
}

# Trap errors
trap 'log_error "Script failed on line $LINENO"' ERR

# Run
main "$@"

