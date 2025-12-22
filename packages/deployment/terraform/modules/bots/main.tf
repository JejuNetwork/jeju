# Bots Module - TFMM and Cross-Chain Arbitrage
# Deploys the bots package for MEV, liquidity, and TFMM strategies

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for services"
  type        = list(string)
}

variable "ecr_repository_url" {
  description = "ECR repository URL for bots"
  type        = string
}

variable "rpc_urls" {
  description = "RPC URLs for each chain"
  type = object({
    ethereum = string
    base     = string
    arbitrum = string
    optimism = string
    bsc      = string
    solana   = optional(string)
  })
}

variable "contracts" {
  description = "Contract addresses"
  type = object({
    tfmm_pool            = optional(string)
    weight_runner        = optional(string)
    oracle_registry      = optional(string)
    fee_controller       = optional(string)
    governance           = optional(string)
    treasury             = optional(string)
  })
  default = {}
}

variable "strategies" {
  description = "Enabled strategies"
  type = object({
    enable_arbitrage    = bool
    enable_cross_chain  = bool
    enable_tfmm         = bool
    enable_liquidity    = bool
    enable_solana_arb   = bool
  })
  default = {
    enable_arbitrage    = true
    enable_cross_chain  = true
    enable_tfmm         = true
    enable_liquidity    = true
    enable_solana_arb   = false
  }
}

variable "tfmm_config" {
  description = "TFMM strategy configuration"
  type = object({
    update_interval_ms       = number
    min_confidence_threshold = number
    max_gas_price_gwei       = number
    blocks_to_target         = number
    min_weight_bps           = number
    max_weight_bps           = number
    max_weight_change_bps    = number
  })
  default = {
    update_interval_ms       = 300000
    min_confidence_threshold = 0.3
    max_gas_price_gwei       = 100
    blocks_to_target         = 300
    min_weight_bps           = 500
    max_weight_bps           = 9500
    max_weight_change_bps    = 500
  }
}

variable "cross_chain_config" {
  description = "Cross-chain arbitrage configuration"
  type = object({
    min_profit_bps      = number
    min_profit_usd      = number
    max_slippage_bps    = number
    max_position_usd    = number
    enable_execution    = bool
  })
  default = {
    min_profit_bps      = 50
    min_profit_usd      = 10
    max_slippage_bps    = 100
    max_position_usd    = 50000
    enable_execution    = false
  }
}

variable "replicas" {
  description = "Number of replicas"
  type        = number
  default     = 1
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Kubernetes namespace
resource "kubernetes_namespace" "bots" {
  metadata {
    name = "bots-${var.environment}"
    labels = {
      app         = "jeju-bots"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}

# Secrets for private keys - MUST be managed via Vault/External Secrets in production
# For localnet, use --set or environment variable injection
resource "kubernetes_secret" "bots_secrets" {
  metadata {
    name      = "bots-secrets"
    namespace = kubernetes_namespace.bots.metadata[0].name
    annotations = {
      # Production should use External Secrets Operator or Vault
      "managed-by" = var.environment == "localnet" ? "terraform-localnet" : "external-secrets"
    }
  }

  data = {
    # SECURITY: For non-localnet, this must be empty and injected via Vault/ESO
    # Localnet can optionally use BOTS_PRIVATE_KEY env var
    PRIVATE_KEY = var.environment == "localnet" ? var.localnet_private_key : ""
  }
}

variable "localnet_private_key" {
  description = "Private key for localnet only - set via TF_VAR_localnet_private_key or -var"
  type        = string
  default     = ""
  sensitive   = true
}

# ConfigMap for bot configuration
resource "kubernetes_config_map" "bots_config" {
  metadata {
    name      = "bots-config"
    namespace = kubernetes_namespace.bots.metadata[0].name
  }

  data = {
    # Network configuration
    ENVIRONMENT = var.environment
    ETH_RPC_URL = var.rpc_urls.ethereum
    BASE_RPC_URL = var.rpc_urls.base
    ARB_RPC_URL = var.rpc_urls.arbitrum
    OP_RPC_URL = var.rpc_urls.optimism
    BSC_RPC_URL = var.rpc_urls.bsc
    SOLANA_RPC_URL = var.rpc_urls.solana != null ? var.rpc_urls.solana : ""
    
    # Contract addresses
    TFMM_POOL_ADDRESS = var.contracts.tfmm_pool != null ? var.contracts.tfmm_pool : ""
    WEIGHT_RUNNER_ADDRESS = var.contracts.weight_runner != null ? var.contracts.weight_runner : ""
    ORACLE_REGISTRY_ADDRESS = var.contracts.oracle_registry != null ? var.contracts.oracle_registry : ""
    FEE_CONTROLLER_ADDRESS = var.contracts.fee_controller != null ? var.contracts.fee_controller : ""
    GOVERNANCE_ADDRESS = var.contracts.governance != null ? var.contracts.governance : ""
    TREASURY_ADDRESS = var.contracts.treasury != null ? var.contracts.treasury : ""
    
    # Strategy toggles
    ENABLE_ARBITRAGE = tostring(var.strategies.enable_arbitrage)
    ENABLE_CROSS_CHAIN = tostring(var.strategies.enable_cross_chain)
    ENABLE_TFMM = tostring(var.strategies.enable_tfmm)
    ENABLE_LIQUIDITY = tostring(var.strategies.enable_liquidity)
    ENABLE_SOLANA_ARB = tostring(var.strategies.enable_solana_arb)
    
    # TFMM configuration
    TFMM_UPDATE_INTERVAL_MS = tostring(var.tfmm_config.update_interval_ms)
    TFMM_MIN_CONFIDENCE = tostring(var.tfmm_config.min_confidence_threshold)
    TFMM_MAX_GAS_GWEI = tostring(var.tfmm_config.max_gas_price_gwei)
    TFMM_BLOCKS_TO_TARGET = tostring(var.tfmm_config.blocks_to_target)
    TFMM_MIN_WEIGHT_BPS = tostring(var.tfmm_config.min_weight_bps)
    TFMM_MAX_WEIGHT_BPS = tostring(var.tfmm_config.max_weight_bps)
    TFMM_MAX_WEIGHT_CHANGE_BPS = tostring(var.tfmm_config.max_weight_change_bps)
    
    # Cross-chain configuration
    CROSS_CHAIN_MIN_PROFIT_BPS = tostring(var.cross_chain_config.min_profit_bps)
    CROSS_CHAIN_MIN_PROFIT_USD = tostring(var.cross_chain_config.min_profit_usd)
    CROSS_CHAIN_MAX_SLIPPAGE_BPS = tostring(var.cross_chain_config.max_slippage_bps)
    CROSS_CHAIN_MAX_POSITION_USD = tostring(var.cross_chain_config.max_position_usd)
    CROSS_CHAIN_ENABLE_EXECUTION = tostring(var.cross_chain_config.enable_execution)
    CROSS_CHAIN_ENABLED_CHAINS = "1,8453,42161,10,56"
    
    # Composite strategy weights
    COMPOSITE_MOMENTUM_WEIGHT = "0.4"
    COMPOSITE_MEAN_REV_WEIGHT = "0.3"
    COMPOSITE_VOL_WEIGHT = "0.3"
    COMPOSITE_REGIME_DETECTION = "true"
  }
}

# Bot Deployment
resource "kubernetes_deployment" "bots" {
  metadata {
    name      = "jeju-bots"
    namespace = kubernetes_namespace.bots.metadata[0].name
    labels = {
      app       = "jeju-bots"
      component = "bot-engine"
    }
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = {
        app       = "jeju-bots"
        component = "bot-engine"
      }
    }

    template {
      metadata {
        labels = {
          app       = "jeju-bots"
          component = "bot-engine"
        }
        annotations = {
          "prometheus.io/scrape" = "true"
          "prometheus.io/port"   = "9090"
          "prometheus.io/path"   = "/metrics"
        }
      }

      spec {
        service_account_name = kubernetes_service_account.bots.metadata[0].name

        container {
          name    = "bot-engine"
          image   = "${var.ecr_repository_url}:latest"
          command = ["bun", "run", "start"]

          env_from {
            config_map_ref {
              name = kubernetes_config_map.bots_config.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.bots_secrets.metadata[0].name
            }
          }

          port {
            container_port = 9090
            name           = "metrics"
          }

          resources {
            requests = {
              cpu    = "500m"
              memory = "1Gi"
            }
            limits = {
              cpu    = "2000m"
              memory = "4Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = 9090
            }
            initial_delay_seconds = 30
            period_seconds        = 30
            timeout_seconds       = 10
          }

          readiness_probe {
            http_get {
              path = "/ready"
              port = 9090
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }
        }
      }
    }
  }
}

# Service Account
resource "kubernetes_service_account" "bots" {
  metadata {
    name      = "jeju-bots"
    namespace = kubernetes_namespace.bots.metadata[0].name
    annotations = {
      "eks.amazonaws.com/role-arn" = var.environment != "localnet" ? aws_iam_role.bots[0].arn : ""
    }
  }
}

# IAM Role for Secrets Manager access (production)
resource "aws_iam_role" "bots" {
  count = var.environment != "localnet" ? 1 : 0
  
  name = "jeju-bots-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${replace(data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer, "https://", "")}"
        }
        Condition = {
          StringEquals = {
            "${replace(data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer, "https://", "")}:sub" = "system:serviceaccount:bots-${var.environment}:jeju-bots"
          }
        }
      }
    ]
  })

  tags = var.tags
}

# Data sources
data "aws_caller_identity" "current" {}

data "aws_eks_cluster" "cluster" {
  name = var.cluster_name
}

# Metrics Service (for Prometheus scraping)
resource "kubernetes_service" "bots_metrics" {
  metadata {
    name      = "jeju-bots-metrics"
    namespace = kubernetes_namespace.bots.metadata[0].name
    labels = {
      app = "jeju-bots"
    }
    annotations = {
      "prometheus.io/scrape" = "true"
      "prometheus.io/port"   = "9090"
    }
  }

  spec {
    selector = {
      app       = "jeju-bots"
      component = "bot-engine"
    }

    port {
      port        = 9090
      target_port = 9090
      name        = "metrics"
    }

    type = "ClusterIP"
  }
}

# Pod Disruption Budget
resource "kubernetes_pod_disruption_budget_v1" "bots" {
  metadata {
    name      = "jeju-bots-pdb"
    namespace = kubernetes_namespace.bots.metadata[0].name
  }

  spec {
    min_available = 1

    selector {
      match_labels = {
        app = "jeju-bots"
      }
    }
  }
}

# Outputs
output "namespace" {
  description = "Kubernetes namespace"
  value       = kubernetes_namespace.bots.metadata[0].name
}

output "deployment_name" {
  description = "Deployment name"
  value       = kubernetes_deployment.bots.metadata[0].name
}

output "metrics_service" {
  description = "Metrics service name"
  value       = kubernetes_service.bots_metrics.metadata[0].name
}

