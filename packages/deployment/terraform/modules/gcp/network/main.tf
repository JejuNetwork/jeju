# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Network Module - VPC, Subnets, NAT, Firewall

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# VPC
resource "google_compute_network" "main" {
  name                    = "${local.name_prefix}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# Public Subnet (for NAT, Load Balancers)
resource "google_compute_subnetwork" "public" {
  name          = "${local.name_prefix}-public"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 0) # /20

  private_ip_google_access = true
}

# Private Subnet (for GKE nodes)
resource "google_compute_subnetwork" "private" {
  name          = "${local.name_prefix}-private"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 1) # /20

  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 4) # /20 for pods
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = cidrsubnet(var.vpc_cidr, 8, 128) # /24 for services (10.x.128.0/24)
  }
}

# Data Subnet (for Cloud SQL)
resource "google_compute_subnetwork" "data" {
  name          = "${local.name_prefix}-data"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 2) # /20

  private_ip_google_access = true
}

# Cloud Router (for NAT)
resource "google_compute_router" "main" {
  name    = "${local.name_prefix}-router"
  project = var.project_id
  region  = var.region
  network = google_compute_network.main.id
}

# Cloud NAT
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

# Firewall - Allow internal
resource "google_compute_firewall" "internal" {
  name    = "${local.name_prefix}-allow-internal"
  project = var.project_id
  network = google_compute_network.main.name

  allow {
    protocol = "icmp"
  }

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  source_ranges = [var.vpc_cidr]
}

# Firewall - Allow SSH (restricted)
resource "google_compute_firewall" "ssh" {
  name    = "${local.name_prefix}-allow-ssh"
  project = var.project_id
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"] # IAP for TCP forwarding
  target_tags   = ["ssh"]
}

# Firewall - Allow HTTP/HTTPS
resource "google_compute_firewall" "http" {
  name    = "${local.name_prefix}-allow-http"
  project = var.project_id
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["http-server", "https-server"]
}

# Private Service Connection (for Cloud SQL)
resource "google_compute_global_address" "private_ip" {
  name          = "${local.name_prefix}-private-ip"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# Firewall - Allow GKE health checks
resource "google_compute_firewall" "health_check" {
  name    = "${local.name_prefix}-allow-health-check"
  project = var.project_id
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"] # GCP health check IPs
  target_tags   = ["gke-node"]
}

# Firewall - Allow GKE master to nodes
resource "google_compute_firewall" "gke_master" {
  name    = "${local.name_prefix}-allow-gke-master"
  project = var.project_id
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["443", "10250"]
  }

  source_ranges = ["172.16.0.0/28"] # Master CIDR
  target_tags   = ["gke-node"]
}

# Outputs
output "vpc_id" {
  value = google_compute_network.main.id
}

output "vpc_name" {
  value = google_compute_network.main.name
}

output "public_subnet_id" {
  value = google_compute_subnetwork.public.id
}

output "private_subnet_id" {
  value = google_compute_subnetwork.private.id
}

output "private_subnet_name" {
  value = google_compute_subnetwork.private.name
}

output "data_subnet_id" {
  value = google_compute_subnetwork.data.id
}

output "pods_ip_range_name" {
  value = "pods"
}

output "services_ip_range_name" {
  value = "services"
}

output "private_service_connection_id" {
  value = google_service_networking_connection.private.id
}

