# Farcaster Hub Infrastructure Module (GCP)
# Deploys self-hosted Farcaster Hubble hub to GKE

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

variable "gke_cluster_name" {
  description = "GKE cluster name"
  type        = string
}

variable "gke_cluster_endpoint" {
  description = "GKE cluster endpoint"
  type        = string
}

variable "gke_cluster_ca_certificate" {
  description = "GKE cluster CA certificate"
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

variable "optimism_rpc_url" {
  description = "Optimism RPC URL for FID verification"
  type        = string
  default     = "https://mainnet.optimism.io"
}

variable "tags" {
  description = "Labels to apply"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-farcaster-${var.environment}"
  hub_domain  = var.environment == "mainnet" ? "hub.jejunetwork.org" : "hub.testnet.jejunetwork.org"
}

# ============================================================
# Data Sources
# ============================================================

data "google_client_config" "default" {}

# ============================================================
# Helm Release for Farcaster Hubble
# ============================================================

resource "helm_release" "farcaster_hubble" {
  name       = "farcaster-hubble"
  namespace  = "farcaster"
  repository = null
  chart      = "${path.module}/../../../kubernetes/helm/farcaster-hubble"
  wait       = true
  timeout    = 600

  values = [
    yamlencode({
      ingress = {
        enabled     = true
        className   = "nginx"
        annotations = {
          "nginx.ingress.kubernetes.io/proxy-read-timeout"  = "3600"
          "nginx.ingress.kubernetes.io/proxy-send-timeout" = "3600"
          "nginx.ingress.kubernetes.io/backend-protocol"   = "GRPC"
        }
        hosts = [
          {
            host = local.hub_domain
            paths = [
              {
                path     = "/"
                pathType = "Prefix"
              }
            ]
          }
        ]
        tls = [
          {
            secretName = "hub-tls"
            hosts      = [local.hub_domain]
          }
        ]
      }

      ethereum = {
        rpcUrl = var.optimism_rpc_url
      }

      persistence = {
        enabled      = true
        storageClass = "pd-ssd"
        size         = var.environment == "mainnet" ? "500Gi" : "200Gi"
      }

      resources = {
        limits = {
          cpu    = var.environment == "mainnet" ? "4000m" : "2000m"
          memory = var.environment == "mainnet" ? "8Gi" : "4Gi"
        }
        requests = {
          cpu    = var.environment == "mainnet" ? "2000m" : "1000m"
          memory = var.environment == "mainnet" ? "4Gi" : "2Gi"
        }
      }

      jeju = {
        indexerEnabled = true
        indexerUrl     = "http://indexer.jeju.svc.cluster.local:4350/graphql"
        syncIdentities = true
        graphqlEnabled = true
      }
    })
  ]

  depends_on = [
    kubernetes_namespace.farcaster
  ]
}

# ============================================================
# Kubernetes Namespace
# ============================================================

resource "kubernetes_namespace" "farcaster" {
  metadata {
    name = "farcaster"
    labels = {
      app     = "farcaster-hubble"
      managed = "terraform"
    }
  }
}

# ============================================================
# Cloud DNS Record for Hub
# ============================================================

resource "google_dns_record_set" "hub" {
  project      = var.project_id
  managed_zone = var.dns_zone_name
  name         = "${local.hub_domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [] # Will be set by ingress controller

  depends_on = [helm_release.farcaster_hubble]
}

# ============================================================
# Secret Manager Secret for Hub URL
# ============================================================

resource "google_secret_manager_secret" "hub_url" {
  project   = var.project_id
  secret_id = "jeju-${var.environment}-farcaster-hub-url"

  replication {
    automatic = true
  }

  labels = merge(var.tags, {
    environment = var.environment
    service     = "farcaster"
  })
}

resource "google_secret_manager_secret_version" "hub_url" {
  secret      = google_secret_manager_secret.hub_url.id
  secret_data = "https://${local.hub_domain}"
}

# ============================================================
# Outputs
# ============================================================

output "hub_url" {
  description = "Farcaster Hub URL (HTTPS via ingress)"
  value       = "https://${local.hub_domain}"
}

output "hub_grpc_url" {
  description = "Farcaster Hub gRPC URL (internal)"
  value       = "${local.hub_domain}:2283"
}

output "hub_http_url" {
  description = "Farcaster Hub HTTP URL (HTTPS via ingress)"
  value       = "https://${local.hub_domain}"
}

output "hub_secret_name" {
  description = "Secret Manager secret name for hub URL"
  value       = google_secret_manager_secret.hub_url.secret_id
}
