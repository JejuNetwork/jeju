# Compute Bridge Node Module
#
# Deploys bridge nodes that connect Jeju to external compute providers (Akash).
# These nodes run as containers on GCP Cloud Run or AWS ECS and manage
# provisioning, payments, and lifecycle of external compute resources.

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 4.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.0"
    }
  }
}

# ============================================================================
# Variables
# ============================================================================

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Deployment region"
  type        = string
  default     = "us-central1"
}

variable "network" {
  description = "Jeju network (localnet, testnet, mainnet)"
  type        = string
  default     = "testnet"

  validation {
    condition     = contains(["localnet", "testnet", "mainnet"], var.network)
    error_message = "Network must be localnet, testnet, or mainnet."
  }
}

variable "bridge_node_count" {
  description = "Number of bridge nodes to deploy"
  type        = number
  default     = 1
}

variable "container_image" {
  description = "Bridge node container image"
  type        = string
  default     = "gcr.io/jeju-network/compute-bridge:latest"
}

variable "jeju_rpc_url" {
  description = "Jeju RPC URL"
  type        = string
}

variable "external_compute_registry_address" {
  description = "ExternalComputeRegistry contract address"
  type        = string
}

variable "cross_chain_paymaster_address" {
  description = "CrossChainPaymaster contract address"
  type        = string
}

variable "jns_registry_address" {
  description = "JNS Registry contract address"
  type        = string
  default     = ""
}

variable "storage_gateway_url" {
  description = "Jeju Storage Gateway URL"
  type        = string
}

variable "akash_network" {
  description = "Akash network (mainnet, testnet)"
  type        = string
  default     = "mainnet"
}

variable "akash_credential_secret_name" {
  description = "GCP Secret Manager secret name for Akash credentials"
  type        = string
}

variable "bridge_node_private_key_secret" {
  description = "GCP Secret Manager secret name for bridge node private key"
  type        = string
}

variable "markup_bps" {
  description = "Bridge node markup in basis points"
  type        = number
  default     = 1000
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}

variable "cpu" {
  description = "CPU allocation per instance"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation per instance"
  type        = string
  default     = "512Mi"
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

# ============================================================================
# Local Values
# ============================================================================

locals {
  service_name = "compute-bridge-${var.network}"
  
  common_labels = merge(var.labels, {
    app       = "compute-bridge"
    network   = var.network
    component = "external-compute"
    managed   = "terraform"
  })

  env_vars = {
    JEJU_RPC_URL                        = var.jeju_rpc_url
    EXTERNAL_COMPUTE_REGISTRY_ADDRESS   = var.external_compute_registry_address
    CROSS_CHAIN_PAYMASTER_ADDRESS       = var.cross_chain_paymaster_address
    JNS_REGISTRY_ADDRESS                = var.jns_registry_address
    STORAGE_GATEWAY_URL                 = var.storage_gateway_url
    AKASH_NETWORK                       = var.akash_network
    BRIDGE_NODE_MARKUP_BPS              = tostring(var.markup_bps)
    ENABLE_AKASH                        = "true"
    ENABLE_EXTERNAL_PROVIDERS           = "true"
    NETWORK                             = var.network
    LOG_LEVEL                           = var.network == "mainnet" ? "info" : "debug"
  }
}

# ============================================================================
# GCP Cloud Run Service
# ============================================================================

resource "google_cloud_run_v2_service" "bridge_node" {
  name     = local.service_name
  location = var.region
  project  = var.project_id

  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.container_image
      name  = "bridge-node"

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      # Environment variables
      dynamic "env" {
        for_each = local.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret: Private key
      env {
        name = "PRIVATE_KEY"
        value_source {
          secret_key_ref {
            secret  = var.bridge_node_private_key_secret
            version = "latest"
          }
        }
      }

      # Secret: Akash credentials
      env {
        name = "AKASH_CREDENTIALS"
        value_source {
          secret_key_ref {
            secret  = var.akash_credential_secret_name
            version = "latest"
          }
        }
      }

      # Ports
      ports {
        container_port = 8080
        name           = "http1"
      }

      # Health check
      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 30
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3
      }
    }

    labels = local.common_labels

    service_account = google_service_account.bridge_node.email

    # VPC access for private networking
    vpc_access {
      egress = "ALL_TRAFFIC"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = local.common_labels

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version
    ]
  }
}

# ============================================================================
# Service Account
# ============================================================================

resource "google_service_account" "bridge_node" {
  account_id   = "compute-bridge-${var.network}"
  display_name = "Compute Bridge Node (${var.network})"
  project      = var.project_id
}

# Secret Manager access
resource "google_secret_manager_secret_iam_member" "private_key_access" {
  secret_id = var.bridge_node_private_key_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bridge_node.email}"
  project   = var.project_id
}

resource "google_secret_manager_secret_iam_member" "akash_creds_access" {
  secret_id = var.akash_credential_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.bridge_node.email}"
  project   = var.project_id
}

# Cloud Run invoker for internal services
resource "google_cloud_run_service_iam_member" "internal_invoker" {
  location = var.region
  project  = var.project_id
  service  = google_cloud_run_v2_service.bridge_node.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.bridge_node.email}"
}

# ============================================================================
# Monitoring & Alerting
# ============================================================================

resource "google_monitoring_alert_policy" "bridge_node_errors" {
  display_name = "Compute Bridge Errors - ${var.network}"
  project      = var.project_id
  combiner     = "OR"

  conditions {
    display_name = "High Error Rate"

    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "${local.service_name}"
        AND metric.type = "run.googleapis.com/request_count"
        AND metric.labels.response_code_class = "5xx"
      EOT
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 10

      trigger {
        count = 1
      }

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = []

  alert_strategy {
    auto_close = "604800s"
  }

  user_labels = local.common_labels
}

resource "google_monitoring_alert_policy" "bridge_node_latency" {
  display_name = "Compute Bridge Latency - ${var.network}"
  project      = var.project_id
  combiner     = "OR"

  conditions {
    display_name = "High Latency"

    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "${local.service_name}"
        AND metric.type = "run.googleapis.com/request_latencies"
      EOT
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 30000 # 30 seconds

      trigger {
        count = 1
      }

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
    }
  }

  notification_channels = []

  alert_strategy {
    auto_close = "604800s"
  }

  user_labels = local.common_labels
}

# ============================================================================
# Outputs
# ============================================================================

output "service_url" {
  description = "Bridge node service URL"
  value       = google_cloud_run_v2_service.bridge_node.uri
}

output "service_name" {
  description = "Bridge node service name"
  value       = google_cloud_run_v2_service.bridge_node.name
}

output "service_account_email" {
  description = "Bridge node service account email"
  value       = google_service_account.bridge_node.email
}

output "service_id" {
  description = "Bridge node service ID"
  value       = google_cloud_run_v2_service.bridge_node.id
}

