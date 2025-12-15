# CovenantSQL Module for GCP - Decentralized Database Cluster
# Uses ARM64 (Tau T2A / Ampere Altra) instances by default for cost savings

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (testnet, mainnet)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "network_name" {
  description = "VPC network name"
  type        = string
}

variable "subnet_name" {
  description = "Subnet name"
  type        = string
}

variable "node_count" {
  description = "Number of CovenantSQL nodes (minimum 3 for consensus)"
  type        = number
  default     = 3
}

variable "use_arm64" {
  description = "Use ARM64 (Tau T2A / Ampere) instances - recommended for cost savings"
  type        = bool
  default     = true
}

variable "machine_type_x86" {
  description = "x86 machine type"
  type        = string
  default     = "e2-medium"
}

variable "machine_type_arm64" {
  description = "ARM64 machine type (Tau T2A)"
  type        = string
  default     = "t2a-standard-2"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 100
}

variable "allowed_source_ranges" {
  description = "CIDR ranges allowed to access nodes"
  type        = list(string)
  default     = []
}

variable "cql_image" {
  description = "CovenantSQL container image (must support ARM64 if use_arm64=true)"
  type        = string
  default     = ""
}

variable "cql_image_tag" {
  description = "CovenantSQL image tag"
  type        = string
  default     = "latest"
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  machine_type = var.use_arm64 ? var.machine_type_arm64 : var.machine_type_x86
  architecture = var.use_arm64 ? "arm64" : "x86_64"
  
  # Use custom image if provided, otherwise use official (x86 only)
  container_image = var.cql_image != "" ? "${var.cql_image}:${var.cql_image_tag}" : "covenantsql/covenantsql:latest"
  
  common_labels = merge(var.labels, {
    environment = var.environment
    component   = "covenantsql"
    architecture = local.architecture
  })
}

# Service Account for CovenantSQL nodes
resource "google_service_account" "covenantsql" {
  account_id   = "covenantsql-${var.environment}"
  display_name = "CovenantSQL Node Service Account"
  project      = var.project_id
}

# IAM: Allow logging
resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.covenantsql.email}"
}

# IAM: Allow metrics
resource "google_project_iam_member" "monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.covenantsql.email}"
}

# Firewall: Client connections
resource "google_compute_firewall" "covenantsql_client" {
  name    = "covenantsql-client-${var.environment}"
  network = var.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["4661"]
  }

  source_ranges = var.allowed_source_ranges
  target_tags   = ["covenantsql"]
}

# Firewall: Node-to-node communication
resource "google_compute_firewall" "covenantsql_internal" {
  name    = "covenantsql-internal-${var.environment}"
  network = var.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["4662", "4663"]
  }

  source_tags = ["covenantsql"]
  target_tags = ["covenantsql"]
}

# Firewall: HTTP API
resource "google_compute_firewall" "covenantsql_http" {
  name    = "covenantsql-http-${var.environment}"
  network = var.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8546"]
  }

  source_ranges = var.allowed_source_ranges
  target_tags   = ["covenantsql"]
}

# Firewall: Health checks from GCP load balancers
resource "google_compute_firewall" "covenantsql_health" {
  name    = "covenantsql-health-${var.environment}"
  network = var.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8546"]
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["covenantsql"]
}

# Instance Template
resource "google_compute_instance_template" "covenantsql" {
  name_prefix  = "covenantsql-${var.environment}-"
  machine_type = local.machine_type
  project      = var.project_id
  region       = var.region

  tags = ["covenantsql"]

  disk {
    source_image = var.use_arm64 ? "ubuntu-os-cloud/ubuntu-2204-lts-arm64" : "ubuntu-os-cloud/ubuntu-2204-lts"
    auto_delete  = true
    boot         = true
    disk_size_gb = var.disk_size_gb
    disk_type    = "pd-ssd"
  }

  network_interface {
    network    = var.network_name
    subnetwork = var.subnet_name
  }

  service_account {
    email  = google_service_account.covenantsql.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    echo "Starting CovenantSQL node setup..."
    echo "Architecture: ${local.architecture}"

    # Install dependencies
    apt-get update
    apt-get install -y docker.io jq curl

    # Start Docker
    systemctl enable docker
    systemctl start docker

    # Get instance metadata
    INSTANCE_NAME=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/name)
    INSTANCE_ZONE=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/zone | cut -d'/' -f4)
    INTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip)

    # Extract node index from instance name (e.g., covenantsql-testnet-001 -> 001)
    NODE_INDEX=$(echo $INSTANCE_NAME | grep -oE '[0-9]+$' || echo "0")

    echo "Node: $INSTANCE_NAME"
    echo "Zone: $INSTANCE_ZONE"
    echo "IP: $INTERNAL_IP"
    echo "Index: $NODE_INDEX"

    # Create directories
    mkdir -p /data/covenantsql/{config,data,logs}

    # Generate config
    cat > /data/covenantsql/config/config.yaml << CONFIGEOF
    IsTestNet: $([ "${var.environment}" == "testnet" ] && echo "true" || echo "false")
    WorkingRoot: /data
    ThisNodeID: node-$NODE_INDEX
    ListenAddr: "0.0.0.0:4661"
    ExternalAddr: "$INTERNAL_IP:4661"
    KayakAddr: "0.0.0.0:4663"
    APIAddr: "0.0.0.0:8546"
    Logging:
      Level: info
      Format: json
    CONFIGEOF

    # Pull and run CovenantSQL
    CQL_IMAGE="${local.container_image}"
    echo "Pulling image: $CQL_IMAGE"
    docker pull $CQL_IMAGE

    # Create systemd service
    cat > /etc/systemd/system/covenantsql.service << SERVICEEOF
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
    ExecStart=/usr/bin/docker run --name covenantsql \\
      -p 4661:4661 -p 4662:4662 -p 4663:4663 -p 8546:8546 \\
      -v /data/covenantsql/config:/config:ro \\
      -v /data/covenantsql/data:/data \\
      -v /data/covenantsql/logs:/logs \\
      $CQL_IMAGE -config /config/config.yaml
    ExecStop=/usr/bin/docker stop covenantsql

    [Install]
    WantedBy=multi-user.target
    SERVICEEOF

    systemctl daemon-reload
    systemctl enable covenantsql
    systemctl start covenantsql

    # Install Cloud Ops agent
    curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
    bash add-google-cloud-ops-agent-repo.sh --also-install

    echo "CovenantSQL node setup complete"
  EOF

  labels = local.common_labels

  lifecycle {
    create_before_destroy = true
  }
}

# Managed Instance Group
resource "google_compute_region_instance_group_manager" "covenantsql" {
  name               = "covenantsql-${var.environment}"
  base_instance_name = "covenantsql-${var.environment}"
  region             = var.region
  project            = var.project_id

  version {
    instance_template = google_compute_instance_template.covenantsql.id
  }

  target_size = var.node_count

  named_port {
    name = "client"
    port = 4661
  }

  named_port {
    name = "http"
    port = 8546
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.covenantsql.id
    initial_delay_sec = 300
  }

  update_policy {
    type                         = "PROACTIVE"
    minimal_action               = "REPLACE"
    most_disruptive_allowed_action = "REPLACE"
    max_surge_fixed              = 1
    max_unavailable_fixed        = 0
  }
}

# Health Check
resource "google_compute_health_check" "covenantsql" {
  name    = "covenantsql-health-${var.environment}"
  project = var.project_id

  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 8546
    request_path = "/v1/health"
  }
}

# Internal Load Balancer
resource "google_compute_region_backend_service" "covenantsql" {
  name                  = "covenantsql-backend-${var.environment}"
  region                = var.region
  project               = var.project_id
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.covenantsql.id]

  backend {
    group = google_compute_region_instance_group_manager.covenantsql.instance_group
  }
}

resource "google_compute_forwarding_rule" "covenantsql_client" {
  name                  = "covenantsql-client-${var.environment}"
  region                = var.region
  project               = var.project_id
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.covenantsql.id
  ports                 = ["4661"]
  network               = var.network_name
  subnetwork            = var.subnet_name
}

resource "google_compute_forwarding_rule" "covenantsql_http" {
  name                  = "covenantsql-http-${var.environment}"
  region                = var.region
  project               = var.project_id
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.covenantsql.id
  ports                 = ["8546"]
  network               = var.network_name
  subnetwork            = var.subnet_name
}

# Outputs
output "client_endpoint" {
  description = "CovenantSQL client endpoint"
  value       = "${google_compute_forwarding_rule.covenantsql_client.ip_address}:4661"
}

output "http_endpoint" {
  description = "CovenantSQL HTTP API endpoint"
  value       = "http://${google_compute_forwarding_rule.covenantsql_http.ip_address}:8546"
}

output "instance_group" {
  description = "Instance group URL"
  value       = google_compute_region_instance_group_manager.covenantsql.instance_group
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.covenantsql.email
}

output "architecture" {
  description = "CPU architecture of nodes"
  value       = local.architecture
}

output "machine_type" {
  description = "Machine type being used"
  value       = local.machine_type
}

output "cql_image" {
  description = "CovenantSQL container image"
  value       = local.container_image
}
