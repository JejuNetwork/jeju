# Compute Bridge Deployment - Testnet
#
# Deploys bridge nodes to connect Jeju testnet to Akash.

terraform {
  required_version = ">= 1.0.0"
}

# ============================================================================
# Variables
# ============================================================================

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

# ============================================================================
# Contract Addresses (Base Sepolia Testnet)
# ============================================================================

locals {
  network = "testnet"
  
  # Contract addresses - update after deployment
  external_compute_registry_address = "0x0000000000000000000000000000000000000000"
  cross_chain_paymaster_address     = "0x0000000000000000000000000000000000000000"
  jns_registry_address              = "0x0000000000000000000000000000000000000000"
  
  # Service URLs
  jeju_rpc_url        = "https://rpc.testnet.jejunetwork.org"
  storage_gateway_url = "https://storage.testnet.jejunetwork.org"
}

# ============================================================================
# Secrets (must be created manually in GCP Secret Manager)
# ============================================================================

# Bridge node private key - create with:
# gcloud secrets create bridge-node-private-key-testnet --replication-policy="automatic"
# echo -n "0x..." | gcloud secrets versions add bridge-node-private-key-testnet --data-file=-

# Akash credentials - create with:
# gcloud secrets create akash-credentials-testnet --replication-policy="automatic"
# echo -n '{"walletMnemonic":"...","walletAddress":"akash...","network":"testnet"}' | gcloud secrets versions add akash-credentials-testnet --data-file=-

# ============================================================================
# Compute Bridge Module
# ============================================================================

module "compute_bridge" {
  source = "../../modules/compute-bridge"

  project_id = var.project_id
  region     = var.region
  network    = local.network

  bridge_node_count = 1
  container_image   = "gcr.io/${var.project_id}/compute-bridge:testnet"

  jeju_rpc_url                      = local.jeju_rpc_url
  external_compute_registry_address = local.external_compute_registry_address
  cross_chain_paymaster_address     = local.cross_chain_paymaster_address
  jns_registry_address              = local.jns_registry_address
  storage_gateway_url               = local.storage_gateway_url

  akash_network                = "testnet"
  akash_credential_secret_name = "akash-credentials-testnet"
  bridge_node_private_key_secret = "bridge-node-private-key-testnet"

  markup_bps = 1000 # 10%

  min_instances = 1
  max_instances = 3
  cpu           = "1"
  memory        = "512Mi"

  labels = {
    environment = "testnet"
    team        = "compute"
  }
}

# ============================================================================
# Outputs
# ============================================================================

output "bridge_service_url" {
  description = "Compute bridge service URL"
  value       = module.compute_bridge.service_url
}

output "bridge_service_account" {
  description = "Bridge node service account"
  value       = module.compute_bridge.service_account_email
}

