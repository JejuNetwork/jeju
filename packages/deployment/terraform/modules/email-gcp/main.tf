# Jeju Network - Email Infrastructure Module (GCP)
#
# Deploys decentralized email infrastructure on GCP:
# - SendGrid/Mailgun for Web2 bridge (inbound/outbound SMTP)
# - DKIM/SPF/DMARC for deliverability
# - Cloud Run for email relay nodes
# - DNS records for email routing
#
# Note: GCP doesn't have a native SES equivalent, so we use
# third-party providers (SendGrid is recommended as it's a Google partner)

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# ============================================================
# Variables
# ============================================================

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "domain_name" {
  description = "Base domain name"
  type        = string
}

variable "email_domain" {
  description = "Email domain (e.g., jeju.mail)"
  type        = string
  default     = "jeju.mail"
}

variable "vpc_name" {
  description = "VPC network name"
  type        = string
}

variable "subnet_name" {
  description = "Subnet name for Cloud Run connector"
  type        = string
}

variable "dns_zone_name" {
  description = "Cloud DNS zone name"
  type        = string
}

variable "gke_cluster_name" {
  description = "GKE cluster name for Workload Identity"
  type        = string
}

variable "jeju_rpc_url" {
  description = "Jeju RPC URL"
  type        = string
}

variable "email_registry_address" {
  description = "EmailRegistry contract address"
  type        = string
  default     = ""
}

variable "email_staking_address" {
  description = "EmailProviderStaking contract address"
  type        = string
  default     = ""
}

variable "dws_endpoint" {
  description = "DWS endpoint for storage"
  type        = string
}

variable "relay_node_count" {
  description = "Number of email relay node instances"
  type        = number
  default     = 3
}

variable "sendgrid_api_key" {
  description = "SendGrid API key (stored in Secret Manager)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "kms_key_id" {
  description = "Cloud KMS key ID for encryption"
  type        = string
}

variable "ingress_ip" {
  description = "GKE ingress IP address for DNS records"
  type        = string
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-email-${var.environment}"

  common_labels = merge(var.labels, {
    service     = "email"
    environment = var.environment
  })
}

# ============================================================
# Secret Manager - API Keys and Credentials
# ============================================================

resource "google_secret_manager_secret" "sendgrid_api_key" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-sendgrid-api-key"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret_version" "sendgrid_api_key" {
  count       = var.sendgrid_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.sendgrid_api_key.id
  secret_data = var.sendgrid_api_key
}

resource "google_secret_manager_secret" "dkim_private_key" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-dkim-private-key"

  replication {
    auto {}
  }

  labels = local.common_labels
}

resource "google_secret_manager_secret" "relay_operator_keys" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-relay-operator-keys"

  replication {
    auto {}
  }

  labels = local.common_labels
}

# ============================================================
# Service Account for Email Services
# ============================================================

resource "google_service_account" "email" {
  project      = var.project_id
  account_id   = "${local.name_prefix}-sa"
  display_name = "Jeju Email Service Account (${var.environment})"
}

# Secret Manager access
resource "google_secret_manager_secret_iam_member" "email_sendgrid" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.sendgrid_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.email.email}"
}

resource "google_secret_manager_secret_iam_member" "email_dkim" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.dkim_private_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.email.email}"
}

resource "google_secret_manager_secret_iam_member" "email_relay_keys" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.relay_operator_keys.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.email.email}"
}

# KMS access for encryption
resource "google_kms_crypto_key_iam_member" "email_kms" {
  crypto_key_id = var.kms_key_id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.email.email}"
}

# Workload Identity for GKE
resource "google_service_account_iam_member" "email_workload_identity" {
  service_account_id = google_service_account.email.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[jeju-email/email-relay]"
}

# ============================================================
# Cloud DNS Records for Email
# ============================================================

# SPF Record - Authorize SendGrid
resource "google_dns_record_set" "spf" {
  name         = "${var.email_domain}."
  type         = "TXT"
  ttl          = 600
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [
    "\"v=spf1 include:sendgrid.net include:_spf.${var.domain_name} ~all\""
  ]
}

# DMARC Record
resource "google_dns_record_set" "dmarc" {
  name         = "_dmarc.${var.email_domain}."
  type         = "TXT"
  ttl          = 600
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [
    "\"v=DMARC1; p=reject; rua=mailto:dmarc@${var.domain_name}; ruf=mailto:dmarc-forensics@${var.domain_name}; fo=1\""
  ]
}

# MX Records - Point to our relay infrastructure
resource "google_dns_record_set" "mx" {
  name         = "${var.email_domain}."
  type         = "MX"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [
    "10 inbound-smtp.${var.environment}.${var.domain_name}."
  ]
}

# Inbound SMTP A record
resource "google_dns_record_set" "inbound_smtp" {
  name         = "inbound-smtp.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

# API endpoint
resource "google_dns_record_set" "email_api" {
  name         = "email-api.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

# SMTP gateway
resource "google_dns_record_set" "smtp" {
  name         = "smtp.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

# IMAP endpoint
resource "google_dns_record_set" "imap" {
  name         = "imap.${var.environment}.${var.domain_name}."
  type         = "A"
  ttl          = 300
  managed_zone = var.dns_zone_name
  project      = var.project_id

  rrdatas = [var.ingress_ip]
}

# ============================================================
# VPC Connector for Cloud Run (if using Cloud Run)
# ============================================================

resource "google_vpc_access_connector" "email" {
  name          = "${local.name_prefix}-connector"
  project       = var.project_id
  region        = var.region
  network       = var.vpc_name
  ip_cidr_range = "10.8.0.0/28"

  min_instances = 2
  max_instances = 10
}

# ============================================================
# Firewall Rules
# ============================================================

resource "google_compute_firewall" "smtp_inbound" {
  name    = "${local.name_prefix}-smtp-inbound"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["25", "587", "465"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${local.name_prefix}-relay"]

  description = "Allow SMTP traffic to email relay nodes"
}

resource "google_compute_firewall" "imap_inbound" {
  name    = "${local.name_prefix}-imap-inbound"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["143", "993"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${local.name_prefix}-relay"]

  description = "Allow IMAP traffic to email relay nodes"
}

resource "google_compute_firewall" "email_api" {
  name    = "${local.name_prefix}-api"
  network = var.vpc_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["443", "8080"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${local.name_prefix}-relay"]

  description = "Allow HTTPS API traffic to email relay nodes"
}

# ============================================================
# Outputs
# ============================================================

output "service_account_email" {
  description = "Service account email for email services"
  value       = google_service_account.email.email
}

output "sendgrid_secret_id" {
  description = "Secret Manager ID for SendGrid API key"
  value       = google_secret_manager_secret.sendgrid_api_key.secret_id
}

output "dkim_secret_id" {
  description = "Secret Manager ID for DKIM private key"
  value       = google_secret_manager_secret.dkim_private_key.secret_id
}

output "relay_keys_secret_id" {
  description = "Secret Manager ID for relay operator keys"
  value       = google_secret_manager_secret.relay_operator_keys.secret_id
}

output "email_api_endpoint" {
  description = "Email API endpoint"
  value       = "https://email-api.${var.environment}.${var.domain_name}"
}

output "smtp_endpoint" {
  description = "SMTP gateway endpoint"
  value       = "smtp.${var.environment}.${var.domain_name}"
}

output "imap_endpoint" {
  description = "IMAP endpoint"
  value       = "imap.${var.environment}.${var.domain_name}"
}

output "email_domain" {
  description = "Email domain"
  value       = var.email_domain
}

output "vpc_connector_id" {
  description = "VPC connector ID for Cloud Run"
  value       = google_vpc_access_connector.email.id
}

output "config" {
  description = "Email infrastructure configuration"
  value = {
    email_domain     = var.email_domain
    smtp_endpoint    = "smtp.${var.environment}.${var.domain_name}"
    imap_endpoint    = "imap.${var.environment}.${var.domain_name}"
    api_endpoint     = "https://email-api.${var.environment}.${var.domain_name}"
    relay_node_count = var.relay_node_count
    service_account  = google_service_account.email.email
  }
}
