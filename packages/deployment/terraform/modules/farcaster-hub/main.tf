# Farcaster Hub Infrastructure Module
# Deploys self-hosted Farcaster Hubble hub to Kubernetes

variable "environment" {
  description = "Environment name (testnet, mainnet)"
  type        = string
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "domain_name" {
  description = "Domain name for services"
  type        = string
}

variable "zone_id" {
  description = "Route53 zone ID"
  type        = string
}

variable "optimism_rpc_url" {
  description = "Optimism RPC URL for FID verification"
  type        = string
  default     = "https://mainnet.optimism.io"
}

variable "tags" {
  description = "Tags to apply"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-farcaster-${var.environment}"
  hub_domain  = var.environment == "mainnet" ? "hub.jejunetwork.org" : "hub.testnet.jejunetwork.org"
}

# ============================================================
# Data Sources for EKS Cluster
# ============================================================

data "aws_eks_cluster" "cluster" {
  name = var.eks_cluster_name
}

data "aws_eks_cluster_auth" "cluster" {
  name = var.eks_cluster_name
}

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
        storageClass = "gp3"
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
# Route53 Record for Hub
# ============================================================

resource "aws_route53_record" "hub" {
  zone_id = var.zone_id
  name    = var.environment == "mainnet" ? "hub" : "hub.testnet"
  type    = "CNAME"
  ttl     = 300
  records = ["${var.eks_cluster_name}-hub.${var.domain_name}"]

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-hub-dns"
  })
}

# ============================================================
# SSM Parameter for Hub URL
# ============================================================

resource "aws_ssm_parameter" "hub_url" {
  name        = "/jeju/${var.environment}/farcaster/hub-url"
  description = "Self-hosted Farcaster Hub URL"
  type        = "String"
  value       = "https://${local.hub_domain}"

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-hub-url"
  })
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

output "hub_ssm_parameter" {
  description = "SSM parameter name for hub URL"
  value       = aws_ssm_parameter.hub_url.name
}
