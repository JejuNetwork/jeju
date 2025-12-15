# =============================================================================
# GCP Confidential Computing Infrastructure for EVMSOL Bridge
# =============================================================================
#
# This deploys:
# - Confidential VM with AMD SEV-SNP or Intel TDX
# - Optional Confidential GPU (A3 instances)
# - VPC and firewall rules
# - Service account with minimal permissions
# - Cloud Logging/Monitoring
#
# Usage:
#   cd deploy/terraform/gcp
#   terraform init
#   terraform plan -var-file=prod.tfvars
#   terraform apply -var-file=prod.tfvars
# =============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    # Configure in backend.tfvars
    # bucket = "your-terraform-state-bucket"
    # prefix = "evmsol-bridge"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# =============================================================================
# VARIABLES
# =============================================================================

variable "project_id" {
  description = "GCP project ID"
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

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "machine_type" {
  description = "Machine type (must support Confidential Computing)"
  type        = string
  default     = "n2d-standard-4"
}

variable "enable_gpu" {
  description = "Enable Confidential GPU (requires A3 instance)"
  type        = bool
  default     = false
}

variable "gpu_machine_type" {
  description = "GPU machine type"
  type        = string
  default     = "a3-highgpu-1g"
}

variable "confidential_type" {
  description = "Confidential instance type (SEV, SEV_SNP, TDX)"
  type        = string
  default     = "SEV_SNP"
}

variable "network_name" {
  description = "Existing VPC network name (leave empty to create new)"
  type        = string
  default     = ""
}

variable "allowed_source_ranges" {
  description = "CIDR ranges allowed to access the bridge"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# =============================================================================
# VPC NETWORK
# =============================================================================

resource "google_compute_network" "main" {
  count = var.network_name == "" ? 1 : 0

  name                    = "evmsol-bridge-${var.environment}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  count = var.network_name == "" ? 1 : 0

  name          = "evmsol-bridge-subnet-${var.environment}"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.main[0].id

  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
  }
}

# =============================================================================
# FIREWALL RULES
# =============================================================================

resource "google_compute_firewall" "allow_ssh" {
  name    = "evmsol-bridge-allow-ssh-${var.environment}"
  network = var.network_name != "" ? var.network_name : google_compute_network.main[0].name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.allowed_source_ranges
  target_tags   = ["evmsol-bridge"]
}

resource "google_compute_firewall" "allow_api" {
  name    = "evmsol-bridge-allow-api-${var.environment}"
  network = var.network_name != "" ? var.network_name : google_compute_network.main[0].name

  allow {
    protocol = "tcp"
    ports    = ["8080", "8081"]
  }

  source_ranges = var.allowed_source_ranges
  target_tags   = ["evmsol-bridge"]
}

resource "google_compute_firewall" "allow_health" {
  name    = "evmsol-bridge-allow-health-${var.environment}"
  network = var.network_name != "" ? var.network_name : google_compute_network.main[0].name

  allow {
    protocol = "tcp"
    ports    = ["8081"]
  }

  # Allow health checks from GCP load balancers
  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["evmsol-bridge"]
}

# =============================================================================
# SERVICE ACCOUNT
# =============================================================================

resource "google_service_account" "bridge" {
  account_id   = "evmsol-bridge-${var.environment}"
  display_name = "EVMSOL Bridge Service Account"
}

resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.bridge.email}"
}

resource "google_project_iam_member" "monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.bridge.email}"
}

resource "google_project_iam_member" "attestation" {
  project = var.project_id
  role    = "roles/confidentialcomputing.workloadUser"
  member  = "serviceAccount:${google_service_account.bridge.email}"
}

# =============================================================================
# CONFIDENTIAL VM (CPU)
# =============================================================================

resource "google_compute_instance" "bridge" {
  count = var.enable_gpu ? 0 : 1

  name         = "evmsol-bridge-${var.environment}"
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["evmsol-bridge"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 50
      type  = "pd-ssd"
    }
  }

  network_interface {
    network    = var.network_name != "" ? var.network_name : google_compute_network.main[0].name
    subnetwork = var.network_name != "" ? null : google_compute_subnetwork.main[0].name

    access_config {
      // Ephemeral public IP
    }
  }

  # Confidential Computing configuration
  confidential_instance_config {
    confidential_instance_type = var.confidential_type
  }

  # Enable vTPM
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    email  = google_service_account.bridge.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    apt-get update && apt-get upgrade -y

    # Install dependencies
    apt-get install -y docker.io curl jq

    # Start Docker
    systemctl enable docker
    systemctl start docker

    # Install monitoring agent
    curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
    bash add-google-cloud-ops-agent-repo.sh --also-install

    # Verify Confidential Computing
    if [ -f /sys/kernel/security/sev ]; then
      echo "SEV enabled" > /var/log/confidential-status.log
    elif [ -d /sys/firmware/tdx ]; then
      echo "TDX enabled" > /var/log/confidential-status.log
    else
      echo "WARNING: No hardware TEE detected" > /var/log/confidential-status.log
    fi

    echo "Setup complete" >> /var/log/confidential-status.log
  EOF

  labels = {
    environment = var.environment
    project     = "evmsol-bridge"
  }

  lifecycle {
    ignore_changes = [metadata_startup_script]
  }
}

# =============================================================================
# CONFIDENTIAL GPU VM (A3)
# =============================================================================

resource "google_compute_instance" "bridge_gpu" {
  count = var.enable_gpu ? 1 : 0

  name         = "evmsol-bridge-gpu-${var.environment}"
  machine_type = var.gpu_machine_type
  zone         = var.zone

  tags = ["evmsol-bridge"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 100
      type  = "pd-ssd"
    }
  }

  network_interface {
    network    = var.network_name != "" ? var.network_name : google_compute_network.main[0].name
    subnetwork = var.network_name != "" ? null : google_compute_subnetwork.main[0].name

    access_config {
      // Ephemeral public IP
    }
  }

  # A3 instances have built-in confidential GPU
  guest_accelerator {
    type  = "nvidia-h100-80gb"
    count = 1
  }

  scheduling {
    on_host_maintenance = "TERMINATE"
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    email  = google_service_account.bridge.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    apt-get update && apt-get upgrade -y

    # Install NVIDIA drivers for H100
    apt-get install -y linux-headers-$(uname -r)
    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
    curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
    apt-get update
    apt-get install -y nvidia-driver-535 nvidia-container-toolkit

    # Install Docker
    apt-get install -y docker.io
    systemctl enable docker
    systemctl start docker

    # Configure NVIDIA Container Runtime
    nvidia-ctk runtime configure --runtime=docker
    systemctl restart docker

    # Install monitoring agent
    curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
    bash add-google-cloud-ops-agent-repo.sh --also-install

    # Verify GPU
    nvidia-smi > /var/log/gpu-status.log

    echo "GPU setup complete" >> /var/log/gpu-status.log
  EOF

  labels = {
    environment = var.environment
    project     = "evmsol-bridge"
    gpu         = "h100"
  }

  lifecycle {
    ignore_changes = [metadata_startup_script]
  }
}

# =============================================================================
# CLOUD LOGGING
# =============================================================================

resource "google_logging_project_sink" "bridge" {
  name        = "evmsol-bridge-logs-${var.environment}"
  destination = "logging.googleapis.com/projects/${var.project_id}/locations/global/buckets/_Default"

  filter = "resource.type=\"gce_instance\" AND labels.project=\"evmsol-bridge\""

  unique_writer_identity = true
}

# =============================================================================
# OUTPUTS
# =============================================================================

output "instance_name" {
  description = "VM instance name"
  value       = var.enable_gpu ? google_compute_instance.bridge_gpu[0].name : google_compute_instance.bridge[0].name
}

output "instance_zone" {
  description = "VM zone"
  value       = var.zone
}

output "public_ip" {
  description = "Public IP address"
  value       = var.enable_gpu ? google_compute_instance.bridge_gpu[0].network_interface[0].access_config[0].nat_ip : google_compute_instance.bridge[0].network_interface[0].access_config[0].nat_ip
}

output "api_endpoint" {
  description = "Bridge API endpoint"
  value       = "http://${var.enable_gpu ? google_compute_instance.bridge_gpu[0].network_interface[0].access_config[0].nat_ip : google_compute_instance.bridge[0].network_interface[0].access_config[0].nat_ip}:8080"
}

output "health_endpoint" {
  description = "Health check endpoint"
  value       = "http://${var.enable_gpu ? google_compute_instance.bridge_gpu[0].network_interface[0].access_config[0].nat_ip : google_compute_instance.bridge[0].network_interface[0].access_config[0].nat_ip}:8081/health"
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.bridge.email
}

output "ssh_command" {
  description = "SSH command to connect"
  value       = "gcloud compute ssh ${var.enable_gpu ? google_compute_instance.bridge_gpu[0].name : google_compute_instance.bridge[0].name} --zone=${var.zone} --project=${var.project_id}"
}
