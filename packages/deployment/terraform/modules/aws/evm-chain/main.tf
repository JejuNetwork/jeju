# Unified EVM Chain Node Infrastructure
# Supports: Ethereum (geth), Base/Optimism (op-geth), Arbitrum (nitro), BSC (bsc-geth)
# Deployed via Helm charts on EKS, managed by Terraform

variable "environment" {
  description = "Environment name (testnet/mainnet)"
  type        = string
}

variable "chain_name" {
  description = "Chain identifier (ethereum, base, optimism, arbitrum, bsc)"
  type        = string
}

variable "chain_id" {
  description = "EVM chain ID"
  type        = number
}

variable "stack_type" {
  description = "Node stack type (ethereum, op-stack, nitro, bsc)"
  type        = string
  validation {
    condition     = contains(["ethereum", "op-stack", "nitro", "bsc"], var.stack_type)
    error_message = "stack_type must be one of: ethereum, op-stack, nitro, bsc"
  }
}

variable "l1_chain_id" {
  description = "L1 chain ID for L2 nodes (null for L1s)"
  type        = number
  default     = null
}

variable "l1_rpc_endpoint" {
  description = "L1 RPC endpoint for L2 nodes"
  type        = string
  default     = ""
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace"
  type        = string
}

variable "storage_size" {
  description = "Storage size for chain data (e.g., 500Gi, 2Ti)"
  type        = string
  default     = "500Gi"
}

variable "storage_class" {
  description = "Storage class for PVCs"
  type        = string
  default     = "gp3"
}

variable "cpu_request" {
  description = "CPU request"
  type        = string
  default     = "2000m"
}

variable "memory_request" {
  description = "Memory request"
  type        = string
  default     = "8Gi"
}

variable "cpu_limit" {
  description = "CPU limit"
  type        = string
  default     = "4000m"
}

variable "memory_limit" {
  description = "Memory limit"
  type        = string
  default     = "16Gi"
}

variable "image_repository" {
  description = "Docker image repository"
  type        = string
}

variable "image_tag" {
  description = "Docker image tag"
  type        = string
}

variable "consensus_image_repository" {
  description = "Consensus client image repository (for PoS chains)"
  type        = string
  default     = ""
}

variable "consensus_image_tag" {
  description = "Consensus client image tag"
  type        = string
  default     = ""
}

variable "network_name" {
  description = "Network name for configuration (e.g., sepolia, base-sepolia, op-sepolia)"
  type        = string
  default     = ""
}

variable "rpc_port" {
  description = "RPC port"
  type        = number
  default     = 8545
}

variable "ws_port" {
  description = "WebSocket port"
  type        = number
  default     = 8546
}

variable "p2p_port" {
  description = "P2P port"
  type        = number
  default     = 30303
}

variable "enable_external_access" {
  description = "Enable external LoadBalancer for RPC access"
  type        = bool
  default     = true
}

variable "domain_name" {
  description = "Domain name for external access"
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Route53 zone ID"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags for resources"
  type        = map(string)
  default     = {}
}

# Locals for computed values
locals {
  full_name = "jeju-${var.environment}-${var.chain_name}"
  labels = {
    "app.kubernetes.io/name"       = var.chain_name
    "app.kubernetes.io/instance"   = local.full_name
    "app.kubernetes.io/component"  = "rpc-node"
    "app.kubernetes.io/managed-by" = "terraform"
    "jeju.network/environment"     = var.environment
    "jeju.network/chain-id"        = tostring(var.chain_id)
    "jeju.network/stack"           = var.stack_type
  }
  
  # Helm chart mapping based on stack type
  helm_chart = {
    ethereum = "geth-l1"
    op-stack = "op-geth"
    nitro    = "nitro"
    bsc      = "bsc-geth"
  }[var.stack_type]
  
  # Internal service endpoint
  internal_rpc_endpoint = "http://${local.full_name}.${var.namespace}.svc.cluster.local:${var.rpc_port}"
  internal_ws_endpoint  = "ws://${local.full_name}.${var.namespace}.svc.cluster.local:${var.ws_port}"
}

# Create namespace if it doesn't exist
resource "kubernetes_namespace" "chain" {
  metadata {
    name = var.namespace
    labels = {
      "jeju.network/managed" = "true"
      "jeju.network/chain"   = var.chain_name
    }
  }
}

# Deploy via Helm
resource "helm_release" "chain_node" {
  name       = local.full_name
  namespace  = kubernetes_namespace.chain.metadata[0].name
  chart      = "${path.module}/../../kubernetes/helm/${local.helm_chart}"
  
  values = [
    yamlencode({
      nameOverride = var.chain_name
      fullnameOverride = local.full_name
      
      image = {
        repository = var.image_repository
        tag        = var.image_tag
      }
      
      # Consensus client for Ethereum PoS
      consensus = var.stack_type == "ethereum" ? {
        enabled    = true
        repository = var.consensus_image_repository
        tag        = var.consensus_image_tag
      } : null
      
      # L2-specific configuration
      l1 = var.stack_type == "op-stack" || var.stack_type == "nitro" ? {
        rpcUrl = var.l1_rpc_endpoint
        chainId = var.l1_chain_id
      } : null
      
      network = var.network_name != "" ? var.network_name : null
      
      persistence = {
        enabled      = true
        storageClass = var.storage_class
        size         = var.storage_size
      }
      
      resources = {
        requests = {
          cpu    = var.cpu_request
          memory = var.memory_request
        }
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
      }
      
      service = {
        type = var.enable_external_access ? "LoadBalancer" : "ClusterIP"
        rpcPort = var.rpc_port
        wsPort  = var.ws_port
        p2pPort = var.p2p_port
        annotations = var.enable_external_access ? {
          "service.beta.kubernetes.io/aws-load-balancer-type" = "nlb"
          "service.beta.kubernetes.io/aws-load-balancer-scheme" = "internet-facing"
        } : {}
      }
      
      # Enable metrics for monitoring
      metrics = {
        enabled = true
        port    = 6060
      }
    })
  ]
  
  timeout = 600
  wait    = true
}

# Create Route53 DNS record if external access enabled
resource "aws_route53_record" "rpc" {
  count = var.enable_external_access && var.zone_id != "" && var.domain_name != "" ? 1 : 0
  
  zone_id = var.zone_id
  name    = "rpc.${var.chain_name}.${var.environment}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  
  records = [data.kubernetes_service.chain_node[0].status[0].load_balancer[0].ingress[0].hostname]
}

# Get the LoadBalancer hostname
data "kubernetes_service" "chain_node" {
  count = var.enable_external_access ? 1 : 0
  
  metadata {
    name      = local.full_name
    namespace = kubernetes_namespace.chain.metadata[0].name
  }
  
  depends_on = [helm_release.chain_node]
}

# Outputs
output "internal_rpc_endpoint" {
  description = "Internal Kubernetes RPC endpoint"
  value       = local.internal_rpc_endpoint
}

output "internal_ws_endpoint" {
  description = "Internal Kubernetes WebSocket endpoint"
  value       = local.internal_ws_endpoint
}

output "external_rpc_endpoint" {
  description = "External RPC endpoint (if enabled)"
  value       = var.enable_external_access && var.domain_name != "" ? "https://rpc.${var.chain_name}.${var.environment}.${var.domain_name}" : null
}

output "chain_id" {
  description = "Chain ID"
  value       = var.chain_id
}

output "chain_name" {
  description = "Chain name"
  value       = var.chain_name
}

output "stack_type" {
  description = "Stack type"
  value       = var.stack_type
}

output "namespace" {
  description = "Kubernetes namespace"
  value       = kubernetes_namespace.chain.metadata[0].name
}
