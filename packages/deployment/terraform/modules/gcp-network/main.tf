# GCP Network Module - VPC and Subnets for Jeju
# Equivalent to AWS VPC module

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

variable "vpc_cidr" {
  description = "Primary CIDR for VPC"
  type        = string
  default     = "10.1.0.0/16"
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# VPC Network
resource "google_compute_network" "main" {
  name                    = "${local.name_prefix}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# Public Subnet (for load balancers, NAT)
resource "google_compute_subnetwork" "public" {
  name          = "${local.name_prefix}-public"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 0) # 10.1.0.0/20

  private_ip_google_access = true
}

# Private Subnet (for GKE nodes)
resource "google_compute_subnetwork" "private" {
  name          = "${local.name_prefix}-private"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 1) # 10.1.16.0/20

  private_ip_google_access = true

  # Secondary ranges for GKE pods and services
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.100.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.101.0.0/20"
  }
}

# Cloud Router (for NAT)
resource "google_compute_router" "main" {
  name    = "${local.name_prefix}-router"
  project = var.project_id
  region  = var.region
  network = google_compute_network.main.id
}

# Cloud NAT (for private subnet egress)
resource "google_compute_router_nat" "main" {
  name                               = "${local.name_prefix}-nat"
  project                            = var.project_id
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Firewall - Allow internal traffic
resource "google_compute_firewall" "internal" {
  name    = "${local.name_prefix}-allow-internal"
  project = var.project_id
  network = google_compute_network.main.id

  allow {
    protocol = "tcp"
  }

  allow {
    protocol = "udp"
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = [var.vpc_cidr]
}

# Firewall - Allow health checks
resource "google_compute_firewall" "health_checks" {
  name    = "${local.name_prefix}-allow-health-checks"
  project = var.project_id
  network = google_compute_network.main.id

  allow {
    protocol = "tcp"
  }

  # Google health check ranges
  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
}

output "network_id" {
  description = "VPC network ID"
  value       = google_compute_network.main.id
}

output "network_name" {
  description = "VPC network name"
  value       = google_compute_network.main.name
}

output "public_subnet_id" {
  description = "Public subnet ID"
  value       = google_compute_subnetwork.public.id
}

output "private_subnet_id" {
  description = "Private subnet ID"
  value       = google_compute_subnetwork.private.id
}

output "private_subnet_name" {
  description = "Private subnet name"
  value       = google_compute_subnetwork.private.name
}

output "pods_range_name" {
  description = "Secondary range name for GKE pods"
  value       = "pods"
}

output "services_range_name" {
  description = "Secondary range name for GKE services"
  value       = "services"
}
