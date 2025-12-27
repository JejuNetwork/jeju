# Jeju Messaging Infrastructure Module - GCP
# Deploys relay nodes, integrates with EQLite and KMS
# GCP equivalent of AWS messaging module

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
}

variable "vpc_name" {
  description = "VPC network name"
  type        = string
}

variable "eqlite_endpoint" {
  description = "EQLite endpoint URL"
  type        = string
}

variable "key_registry_address" {
  description = "KeyRegistry contract address on Jeju L2"
  type        = string
  default     = ""
}

variable "node_registry_address" {
  description = "MessageNodeRegistry contract address on Jeju L2"
  type        = string
  default     = ""
}

variable "farcaster_hub_url" {
  description = "Farcaster Hub gRPC URL"
  type        = string
  default     = "nemes.farcaster.xyz:2283"
}

variable "kms_key_id" {
  description = "Cloud KMS key ID for encrypting secrets"
  type        = string
}

variable "domain_name" {
  description = "Domain name for services"
  type        = string
}

variable "dns_zone_name" {
  description = "Cloud DNS zone name"
  type        = string
}

variable "ingress_ip" {
  description = "GKE ingress IP address for DNS records"
  type        = string
}

variable "labels" {
  description = "Labels to apply"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-messaging-${var.environment}"
}

# ============================================================
# Firewall Rules (equivalent to AWS Security Groups)
# ============================================================

resource "google_compute_firewall" "relay" {
  name    = "${local.name_prefix}-relay"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["3200", "3201"]
  }

  source_ranges = ["10.0.0.0/8"]
  target_tags   = ["${local.name_prefix}-relay"]

  description = "Allow relay node traffic from internal network"
}

resource "google_compute_firewall" "kms_api" {
  name    = "${local.name_prefix}-kms-api"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["3300"]
  }

  source_ranges = ["10.0.0.0/8"]
  target_tags   = ["${local.name_prefix}-kms"]

  description = "Allow KMS API traffic from internal network"
}

# ============================================================
# Secret Manager (equivalent to AWS Secrets Manager)
# ============================================================

resource "google_secret_manager_secret" "relay_operator_keys" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-relay-operator-keys"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret" "kms_master_key" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-kms-master-key"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret" "eqlite_credentials" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-eqlite-credentials"

  replication {
    auto {}
  }

  labels = var.labels
}

# ============================================================
# Service Account for Messaging Services (Workload Identity)
# ============================================================

resource "google_service_account" "messaging" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-sa"
  display_name = "Jeju Messaging Service Account (${var.environment})"
}

# IAM binding for accessing secrets
resource "google_secret_manager_secret_iam_member" "relay_keys_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.relay_operator_keys.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.messaging.email}"
}

resource "google_secret_manager_secret_iam_member" "kms_master_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.kms_master_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.messaging.email}"
}

resource "google_secret_manager_secret_iam_member" "eqlite_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.eqlite_credentials.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.messaging.email}"
}

# IAM binding for Cloud KMS
resource "google_kms_crypto_key_iam_member" "messaging_kms" {
  crypto_key_id = var.kms_key_id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.messaging.email}"
}

# Workload Identity binding for GKE
resource "google_service_account_iam_member" "messaging_workload_identity" {
  service_account_id = google_service_account.messaging.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[jeju-messaging/messaging]"
}

# ============================================================
# Cloud DNS Records
# ============================================================

resource "google_dns_record_set" "relay" {
  name         = "relay.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

resource "google_dns_record_set" "kms" {
  name         = "kms.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

# ============================================================
# Outputs
# ============================================================

output "relay_firewall_name" {
  description = "Firewall rule name for relay nodes"
  value       = google_compute_firewall.relay.name
}

output "kms_firewall_name" {
  description = "Firewall rule name for KMS API"
  value       = google_compute_firewall.kms_api.name
}

output "messaging_service_account_email" {
  description = "Service account email for messaging services"
  value       = google_service_account.messaging.email
}

output "relay_operator_keys_secret_id" {
  description = "Secret Manager ID for relay operator keys"
  value       = google_secret_manager_secret.relay_operator_keys.secret_id
}

output "kms_master_key_secret_id" {
  description = "Secret Manager ID for KMS master key"
  value       = google_secret_manager_secret.kms_master_key.secret_id
}

output "eqlite_credentials_secret_id" {
  description = "Secret Manager ID for EQLite credentials"
  value       = google_secret_manager_secret.eqlite_credentials.secret_id
}

output "relay_endpoint" {
  description = "Relay endpoint URL"
  value       = "https://relay.${var.environment}.${var.domain_name}"
}

output "kms_endpoint" {
  description = "KMS API endpoint URL"
  value       = "https://kms.${var.environment}.${var.domain_name}"
}

output "service_discovery" {
  description = "Service discovery configuration"
  value = {
    relay_endpoint = "https://relay.${var.environment}.${var.domain_name}"
    kms_endpoint   = "https://kms.${var.environment}.${var.domain_name}"
    eqlite    = var.eqlite_endpoint
    farcaster_hub  = var.farcaster_hub_url
    key_registry   = var.key_registry_address
    node_registry  = var.node_registry_address
  }
}
