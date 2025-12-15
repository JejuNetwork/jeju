# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# Jeju Network - GCP Mainnet Environment
# Production multi-cloud deployment (cross-cloud with AWS for resilience)

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "gcs" {
    bucket = "jeju-terraform-state-mainnet"
    prefix = "gcp-mainnet"
  }
}

# ============================================================
# Variables
# ============================================================
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "secondary_region" {
  description = "Secondary GCP region for HA"
  type        = string
  default     = "us-east1"
}

variable "domain_name" {
  description = "Base domain name"
  type        = string
  default     = "jeju.network"
}

variable "create_dns_zone" {
  description = "Create new Cloud DNS zone"
  type        = bool
  default     = false # Assume testnet already created it
}

variable "enable_cloud_armor" {
  description = "Enable Cloud Armor WAF"
  type        = bool
  default     = true
}

locals {
  environment = "mainnet"
  common_labels = {
    project     = "jeju-network"
    environment = "mainnet"
    managed-by  = "terraform"
    cost-center = "production"
  }
}

# ============================================================
# Providers
# ============================================================
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ============================================================
# Enable Required APIs
# ============================================================
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudkms.googleapis.com",
    "dns.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "iap.googleapis.com",
  ])

  project = var.project_id
  service = each.key

  disable_dependent_services = false
  disable_on_destroy         = false
}

# ============================================================
# Module: Network
# ============================================================
module "network" {
  source = "../../modules/gcp/network"

  project_id  = var.project_id
  environment = local.environment
  region      = var.region
  vpc_cidr    = "10.2.0.0/16" # Different from testnet

  depends_on = [google_project_service.apis]
}

# ============================================================
# Module: Cloud DNS (use existing zone from testnet)
# ============================================================
module "cloud_dns" {
  source = "../../modules/gcp/cloud-dns"

  project_id  = var.project_id
  environment = local.environment
  domain_name = var.domain_name
  create_zone = var.create_dns_zone
}

# ============================================================
# Module: GKE Cluster (Production sized)
# ============================================================
module "gke" {
  source = "../../modules/gcp/gke"

  project_id             = var.project_id
  environment            = local.environment
  region                 = var.region
  vpc_name               = module.network.vpc_name
  subnet_name            = module.network.private_subnet_name
  pods_ip_range_name     = module.network.pods_ip_range_name
  services_ip_range_name = module.network.services_ip_range_name
  cluster_version        = "1.29"

  # Production node pools (larger than testnet)
  node_pools = [
    {
      name          = "general"
      machine_type  = "e2-standard-8" # Larger for production
      min_count     = 3
      max_count     = 15
      initial_count = 5
      disk_size_gb  = 100
      disk_type     = "pd-ssd"
      labels        = { workload = "general" }
      taints        = []
    },
    {
      name          = "rpc"
      machine_type  = "n2-standard-8" # Higher performance for RPC
      min_count     = 2
      max_count     = 10
      initial_count = 3
      disk_size_gb  = 200
      disk_type     = "pd-ssd"
      labels        = { workload = "rpc" }
      taints = [
        {
          key    = "workload"
          value  = "rpc"
          effect = "NO_SCHEDULE"
        }
      ]
    },
    {
      name          = "indexer"
      machine_type  = "e2-standard-8"
      min_count     = 2
      max_count     = 8
      initial_count = 3
      disk_size_gb  = 200
      disk_type     = "pd-ssd"
      labels        = { workload = "indexer" }
      taints        = []
    },
    {
      name          = "sequencer"
      machine_type  = "n2-standard-16" # High performance for sequencer
      min_count     = 1
      max_count     = 3
      initial_count = 2
      disk_size_gb  = 500
      disk_type     = "pd-ssd"
      labels        = { workload = "sequencer" }
      taints = [
        {
          key    = "workload"
          value  = "sequencer"
          effect = "NO_SCHEDULE"
        }
      ]
    }
  ]

  depends_on = [module.network]
}

# ============================================================
# Module: Cloud SQL (Production HA)
# ============================================================
module "cloudsql" {
  source = "../../modules/gcp/cloudsql"

  project_id                    = var.project_id
  environment                   = local.environment
  region                        = var.region
  vpc_id                        = module.network.vpc_id
  private_service_connection_id = module.network.private_service_connection_id
  tier                          = "db-custom-4-16384" # 4 vCPU, 16GB (production)
  disk_size_gb                  = 500
  disk_autoresize_limit         = 2000
  availability_type             = "REGIONAL"
  backup_retention_days         = 30
  database_version              = "POSTGRES_15"

  depends_on = [module.network]
}

# ============================================================
# Module: Artifact Registry
# ============================================================
module "artifact_registry" {
  source = "../../modules/gcp/artifact-registry"

  project_id  = var.project_id
  environment = local.environment
  region      = var.region
}

# ============================================================
# Module: Cloud Armor (Production WAF)
# ============================================================
module "cloud_armor" {
  source = "../../modules/gcp/cloud-armor"

  project_id          = var.project_id
  environment         = local.environment
  enabled             = var.enable_cloud_armor
  rate_limit_requests = 5000 # Higher for production
  rate_limit_interval = 60
}

# ============================================================
# Cloud KMS (Production)
# ============================================================
resource "google_kms_key_ring" "main" {
  name     = "jeju-${local.environment}-keyring"
  project  = var.project_id
  location = var.region
}

resource "google_kms_crypto_key" "main" {
  name     = "jeju-${local.environment}-key"
  key_ring = google_kms_key_ring.main.id

  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true # Protect production keys
  }
}

# ============================================================
# Kubernetes Provider
# ============================================================
data "google_client_config" "default" {}

provider "kubernetes" {
  host                   = "https://${module.gke.cluster_endpoint}"
  token                  = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = "https://${module.gke.cluster_endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(module.gke.cluster_ca_certificate)
  }
}

# ============================================================
# Outputs
# ============================================================
output "gke_cluster_name" {
  value = module.gke.cluster_name
}

output "gke_cluster_endpoint" {
  value = module.gke.cluster_endpoint
}

output "cloudsql_private_ip" {
  value = module.cloudsql.private_ip
}

output "mainnet_urls" {
  value = {
    rpc     = "https://rpc.${var.domain_name}"
    ws      = "wss://ws.${var.domain_name}"
    api     = "https://api.${var.domain_name}"
    gateway = "https://gateway.${var.domain_name}"
    bazaar  = "https://bazaar.${var.domain_name}"
  }
}

output "multi_cloud_status" {
  value = <<-EOT
    ═══════════════════════════════════════════════════════════════════
    MULTI-CLOUD MAINNET DEPLOYMENT
    ═══════════════════════════════════════════════════════════════════
    
    GCP Region: ${var.region}
    AWS Region: us-east-1 (configured separately)
    
    Cross-Cloud Architecture:
    - GCP: Primary RPC nodes, Sequencer backup, Indexer
    - AWS: Sequencer primary, Batcher, Proposer, Challenger
    - Both: Load balanced via CloudFlare/Global LB
    
    Failover Strategy:
    - DNS-based failover with health checks
    - Sequencer: Active-passive (AWS primary, GCP standby)
    - RPC: Active-active load balancing
    - Data: Cross-cloud DB replication (manual sync)
    ═══════════════════════════════════════════════════════════════════
  EOT
}

