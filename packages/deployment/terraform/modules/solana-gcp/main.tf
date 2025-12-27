# Solana RPC Node Infrastructure for Jeju Network - GCP
# Provides dedicated Solana RPC endpoints for cross-chain token operations
# GCP equivalent of AWS solana module

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (testnet/mainnet)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "zone" {
  description = "GCP zone for instances"
  type        = string
  default     = ""
}

variable "vpc_name" {
  description = "VPC network name"
  type        = string
}

variable "subnet_name" {
  description = "Subnet name for node placement"
  type        = string
}

variable "solana_network" {
  description = "Solana network (mainnet-beta, devnet, testnet)"
  type        = string
  default     = "devnet"
}

variable "node_count" {
  description = "Number of Solana RPC nodes"
  type        = number
  default     = 2
}

variable "machine_type" {
  description = "GCE machine type for Solana nodes"
  type        = string
  default     = "n2-highmem-8" # Solana needs significant resources
}

variable "disk_size_gb" {
  description = "Disk size for ledger storage"
  type        = number
  default     = 2000 # Solana ledger is large
}

variable "labels" {
  description = "Labels for resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}-solana"
  zone        = var.zone != "" ? var.zone : "${var.region}-a"
}

# ============================================================
# Firewall Rules
# ============================================================

resource "google_compute_firewall" "solana_rpc" {
  name    = "${local.name_prefix}-rpc"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8899", "8900"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.name_prefix]

  description = "Allow Solana RPC and WebSocket traffic"
}

resource "google_compute_firewall" "solana_gossip" {
  name    = "${local.name_prefix}-gossip"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8000-8020"]
  }

  allow {
    protocol = "udp"
    ports    = ["8000-8020"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.name_prefix]

  description = "Allow Solana Gossip and TPU traffic"
}

resource "google_compute_firewall" "solana_ssh" {
  name    = "${local.name_prefix}-ssh"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["10.0.0.0/8"]
  target_tags   = [local.name_prefix]

  description = "Allow SSH from internal network"
}

# ============================================================
# Service Account
# ============================================================

resource "google_service_account" "solana" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-sa"
  display_name = "Solana RPC Node Service Account (${var.environment})"
}

# ============================================================
# Instance Template
# ============================================================

resource "google_compute_instance_template" "solana" {
  name_prefix  = "${local.name_prefix}-"
  project      = var.project_id
  machine_type = var.machine_type
  region       = var.region

  disk {
    source_image = "ubuntu-os-cloud/ubuntu-2204-lts"
    auto_delete  = true
    boot         = true
    disk_size_gb = 100
    disk_type    = "pd-ssd"
  }

  # Ledger storage disk
  disk {
    auto_delete  = false
    boot         = false
    disk_size_gb = var.disk_size_gb
    disk_type    = "pd-ssd"
  }

  network_interface {
    network    = var.vpc_name
    subnetwork = var.subnet_name

    access_config {
      # Ephemeral external IP
    }
  }

  service_account {
    email  = google_service_account.solana.email
    scopes = ["cloud-platform"]
  }

  tags = [local.name_prefix]

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    apt-get update
    apt-get upgrade -y

    # Install dependencies
    apt-get install -y curl wget jq

    # Mount ledger disk (second disk)
    LEDGER_DISK=$(lsblk -o NAME -n | grep -v sda | head -1)
    mkfs.ext4 /dev/$LEDGER_DISK || true
    mkdir -p /mnt/solana-ledger
    mount /dev/$LEDGER_DISK /mnt/solana-ledger
    echo "/dev/$LEDGER_DISK /mnt/solana-ledger ext4 defaults 0 2" >> /etc/fstab

    # Create solana user
    useradd -m -s /bin/bash solana
    chown solana:solana /mnt/solana-ledger

    # Install Solana CLI
    su - solana -c 'sh -c "$(curl -sSfL https://release.solana.com/stable/install)"'

    # Create systemd service
    cat > /etc/systemd/system/solana.service <<'SOLANA_SERVICE'
    [Unit]
    Description=Solana RPC Node
    After=network.target

    [Service]
    Type=simple
    User=solana
    WorkingDirectory=/home/solana
    Environment="PATH=/home/solana/.local/share/solana/install/active_release/bin:/usr/bin"
    ExecStart=/home/solana/.local/share/solana/install/active_release/bin/solana-validator \
      --identity /home/solana/validator-keypair.json \
      --vote-account /home/solana/vote-account-keypair.json \
      --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \
      --known-validator dv2eQHeP4RFrJZ6UeiZWoc3XTtmtZCUKxxCApCDcRNV \
      --only-known-rpc \
      --ledger /mnt/solana-ledger \
      --rpc-port 8899 \
      --dynamic-port-range 8000-8020 \
      --entrypoint entrypoint.${var.solana_network}.solana.com:8001 \
      --expected-genesis-hash ${var.solana_network == "mainnet-beta" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : var.solana_network == "devnet" ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"} \
      --wal-recovery-mode skip_any_corrupted_record \
      --no-wait-for-vote-to-start-leader \
      --enable-rpc-transaction-history \
      --enable-cpi-and-log-storage \
      --rpc-bind-address 0.0.0.0 \
      --limit-ledger-size
    Restart=on-failure
    RestartSec=10

    [Install]
    WantedBy=multi-user.target
    SOLANA_SERVICE

    # Generate keypairs if they don't exist
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana-keygen new -o /home/solana/validator-keypair.json --no-passphrase || true'
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana-keygen new -o /home/solana/vote-account-keypair.json --no-passphrase || true'

    # Configure Solana CLI
    su - solana -c '/home/solana/.local/share/solana/install/active_release/bin/solana config set --url https://api.${var.solana_network}.solana.com'

    # Start service
    systemctl daemon-reload
    systemctl enable solana
    systemctl start solana
  EOF

  labels = var.labels

  lifecycle {
    create_before_destroy = true
  }
}

# ============================================================
# Managed Instance Group
# ============================================================

resource "google_compute_instance_group_manager" "solana" {
  name               = local.name_prefix
  project            = var.project_id
  base_instance_name = local.name_prefix
  zone               = local.zone
  target_size        = var.node_count

  version {
    instance_template = google_compute_instance_template.solana.id
  }

  named_port {
    name = "rpc"
    port = 8899
  }

  named_port {
    name = "websocket"
    port = 8900
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.solana.id
    initial_delay_sec = 300
  }
}

# ============================================================
# Health Check
# ============================================================

resource "google_compute_health_check" "solana" {
  name    = "${local.name_prefix}-health"
  project = var.project_id

  timeout_sec        = 5
  check_interval_sec = 30

  tcp_health_check {
    port = 8899
  }
}

# ============================================================
# Network Load Balancer
# ============================================================

# External IP for load balancer
resource "google_compute_address" "solana" {
  name    = "${local.name_prefix}-ip"
  project = var.project_id
  region  = var.region
}

# Backend service for RPC
resource "google_compute_region_backend_service" "solana_rpc" {
  name                  = "${local.name_prefix}-rpc-backend"
  project               = var.project_id
  region                = var.region
  load_balancing_scheme = "EXTERNAL"
  protocol              = "TCP"
  health_checks         = [google_compute_health_check.solana.id]

  backend {
    group = google_compute_instance_group_manager.solana.instance_group
  }
}

# Backend service for WebSocket
resource "google_compute_region_backend_service" "solana_ws" {
  name                  = "${local.name_prefix}-ws-backend"
  project               = var.project_id
  region                = var.region
  load_balancing_scheme = "EXTERNAL"
  protocol              = "TCP"
  health_checks         = [google_compute_health_check.solana.id]

  backend {
    group = google_compute_instance_group_manager.solana.instance_group
  }
}

# Forwarding rule for RPC
resource "google_compute_forwarding_rule" "solana_rpc" {
  name                  = "${local.name_prefix}-rpc-fwd"
  project               = var.project_id
  region                = var.region
  ip_address            = google_compute_address.solana.address
  ip_protocol           = "TCP"
  port_range            = "8899"
  load_balancing_scheme = "EXTERNAL"
  backend_service       = google_compute_region_backend_service.solana_rpc.id
}

# Forwarding rule for WebSocket
resource "google_compute_forwarding_rule" "solana_ws" {
  name                  = "${local.name_prefix}-ws-fwd"
  project               = var.project_id
  region                = var.region
  ip_address            = google_compute_address.solana.address
  ip_protocol           = "TCP"
  port_range            = "8900"
  load_balancing_scheme = "EXTERNAL"
  backend_service       = google_compute_region_backend_service.solana_ws.id
}

# ============================================================
# Outputs
# ============================================================

output "rpc_endpoint" {
  description = "Solana RPC endpoint"
  value       = "http://${google_compute_address.solana.address}:8899"
}

output "ws_endpoint" {
  description = "Solana WebSocket endpoint"
  value       = "ws://${google_compute_address.solana.address}:8900"
}

output "lb_ip" {
  description = "Load balancer IP address"
  value       = google_compute_address.solana.address
}

output "instance_group" {
  description = "Instance group name"
  value       = google_compute_instance_group_manager.solana.name
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.solana.email
}
