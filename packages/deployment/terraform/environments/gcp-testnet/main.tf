# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# Jeju Network - GCP Testnet Environment
# Complete infrastructure on Google Cloud Platform

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
    bucket = "jeju-terraform-state-testnet"
    prefix = "terraform/state"
  }
}

# ============================================================
# Variables
# ============================================================
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "domain_name" {
  description = "Base domain name"
  type        = string
  default     = "jeju.network"
}

variable "create_dns_zone" {
  description = "Create new Cloud DNS zone"
  type        = bool
  default     = true
}

variable "enable_cloud_armor" {
  description = "Enable Cloud Armor WAF"
  type        = bool
  default     = true
}

locals {
  environment = "testnet"
  common_labels = {
    project     = "jeju-network"
    environment = "testnet"
    managed_by  = "terraform"
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
# Module: Network (VPC, Subnets, NAT)
# ============================================================
module "network" {
  source = "../../modules/gcp/network"

  project_id  = var.project_id
  environment = local.environment
  region      = var.region
  vpc_cidr    = "10.1.0.0/16"

  depends_on = [google_project_service.apis]
}

# ============================================================
# Module: Cloud DNS
# ============================================================
module "cloud_dns" {
  source = "../../modules/gcp/cloud-dns"

  project_id  = var.project_id
  environment = local.environment
  domain_name = var.domain_name
  create_zone = var.create_dns_zone
}

# ============================================================
# Module: GKE Cluster
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

  # Reduced node pools to fit within testnet quota (32 vCPU total)
  # Scale up for mainnet deployment
  node_pools = [
    {
      name          = "general"
      machine_type  = "e2-standard-2"
      min_count     = 1
      max_count     = 4
      initial_count = 2
      disk_size_gb  = 30
      disk_type     = "pd-balanced"
      labels        = { workload = "general" }
      taints        = []
    },
    {
      name          = "rpc"
      machine_type  = "e2-standard-2"
      min_count     = 1
      max_count     = 3
      initial_count = 1
      disk_size_gb  = 50
      disk_type     = "pd-balanced"
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
      machine_type  = "e2-standard-2"
      min_count     = 1
      max_count     = 2
      initial_count = 1
      disk_size_gb  = 50
      disk_type     = "pd-balanced"
      labels        = { workload = "indexer" }
      taints        = []
    }
  ]

  depends_on = [module.network]
}

# ============================================================
# Module: Cloud SQL (PostgreSQL)
# ============================================================
module "cloudsql" {
  source = "../../modules/gcp/cloudsql"

  project_id                    = var.project_id
  environment                   = local.environment
  region                        = var.region
  vpc_id                        = module.network.vpc_id
  private_service_connection_id = module.network.private_service_connection_id
  tier                          = "db-custom-2-8192"
  disk_size_gb                  = 100
  disk_autoresize_limit         = 500
  availability_type             = "REGIONAL"
  backup_retention_days         = 7
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
# Module: Cloud Armor (WAF)
# ============================================================
module "cloud_armor" {
  source = "../../modules/gcp/cloud-armor"

  project_id          = var.project_id
  environment         = local.environment
  enabled             = var.enable_cloud_armor
  rate_limit_requests = 2000
  rate_limit_interval = 60
}

# ============================================================
# Module: Cloud KMS
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
    prevent_destroy = false
  }
}

# ============================================================
# Kubernetes Provider (after GKE is ready)
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
output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "gke_cluster_name" {
  description = "GKE cluster name"
  value       = module.gke.cluster_name
}

output "gke_cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = module.gke.cluster_endpoint
}

output "cloudsql_connection_name" {
  description = "Cloud SQL connection name"
  value       = module.cloudsql.connection_name
}

output "cloudsql_private_ip" {
  description = "Cloud SQL private IP"
  value       = module.cloudsql.private_ip
}

output "artifact_registry_urls" {
  description = "Artifact Registry repository URLs"
  value       = module.artifact_registry.repository_urls
}

output "dns_nameservers" {
  description = "Cloud DNS nameservers"
  value       = module.cloud_dns.nameservers
}

output "cloud_armor_policy" {
  description = "Cloud Armor security policy"
  value       = module.cloud_armor.policy_name
}

output "kms_key_id" {
  description = "Cloud KMS key ID"
  value       = google_kms_crypto_key.main.id
}

output "testnet_urls" {
  description = "Testnet service URLs"
  value = {
    rpc     = "https://testnet-rpc.${var.domain_name}"
    ws      = "wss://testnet-ws.${var.domain_name}"
    api     = "https://api.testnet.${var.domain_name}"
    gateway = "https://gateway.testnet.${var.domain_name}"
    bazaar  = "https://bazaar.testnet.${var.domain_name}"
  }
}

output "next_steps" {
  description = "Post-deployment instructions"
  value       = <<-EOT
    ═══════════════════════════════════════════════════════════════════
    GCP DEPLOYMENT COMPLETE - Next Steps:
    ═══════════════════════════════════════════════════════════════════
    
    1. UPDATE DOMAIN NAMESERVERS at your registrar to:
       ${join("\n       ", module.cloud_dns.nameservers)}
    
    2. Configure kubectl:
       gcloud container clusters get-credentials ${module.gke.cluster_name} \
         --region ${var.region} --project ${var.project_id}
    
    3. Deploy applications:
       cd packages/deployment && NETWORK=testnet CLOUD=gcp bun run scripts/helmfile.ts sync
    
    4. Deploy contracts:
       bun run scripts/deploy/oif-multichain.ts --all
    
    5. Cloud SQL Proxy (for local access):
       cloud-sql-proxy ${module.cloudsql.connection_name}
    ═══════════════════════════════════════════════════════════════════
  EOT
}

# ============================================================
# Cost Comparison Data
# ============================================================
output "cost_comparison" {
  description = "Monthly cost estimates for comparison with AWS"
  value = {
    gke_cluster = {
      description = "GKE Autopilot or Standard cluster"
      nodes       = "7 nodes (3 general, 2 rpc, 2 indexer)"
      estimate    = "$800-1200/month"
    }
    cloudsql = {
      description = "Cloud SQL PostgreSQL (db-custom-2-8192, HA)"
      disk        = "100GB SSD, autoscale to 500GB"
      estimate    = "$150-250/month"
    }
    networking = {
      description = "VPC, NAT, Load Balancer"
      estimate    = "$100-200/month"
    }
    storage = {
      description = "Persistent Disks, Artifact Registry"
      estimate    = "$100-150/month"
    }
    total_estimate = "$1150-1800/month"

    aws_comparison = {
      eks        = "$1000-1500/month"
      rds        = "$200-300/month"
      networking = "$150-250/month"
      storage    = "$100-150/month"
      total      = "$1450-2200/month"
    }
  }
}
