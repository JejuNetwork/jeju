# Crucible Module - Decentralized Agent Orchestration
# Deploys API server and executor service

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
  description = "ECR repository URL for crucible"
  type        = string
}

variable "rpc_url" {
  description = "RPC URL for blockchain access"
  type        = string
}

variable "contracts" {
  description = "Contract addresses"
  type = object({
    agent_vault       = string
    room_registry     = string
    trigger_registry  = string
    identity_registry = string
    service_registry  = string
  })
}

variable "services" {
  description = "Service URLs"
  type = object({
    compute_marketplace = string
    storage_api         = string
    ipfs_gateway        = string
    indexer_graphql     = string
  })
}

variable "replicas" {
  description = "Number of replicas per service"
  type = object({
    api      = number
    executor = number
  })
  default = {
    api      = 2
    executor = 1
  }
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# Kubernetes namespace
resource "kubernetes_namespace" "crucible" {
  metadata {
    name = "crucible-${var.environment}"
    labels = {
      app         = "crucible"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}

# Secrets for private key (should be managed via Vault in production)
resource "kubernetes_secret" "crucible_secrets" {
  metadata {
    name      = "crucible-secrets"
    namespace = kubernetes_namespace.crucible.metadata[0].name
  }

  data = {
    # In production, inject via Vault
    PRIVATE_KEY = var.environment == "localnet" ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : ""
  }
}

# ConfigMap for service configuration
resource "kubernetes_config_map" "crucible_config" {
  metadata {
    name      = "crucible-config"
    namespace = kubernetes_namespace.crucible.metadata[0].name
  }

  data = {
    NETWORK                 = var.environment
    RPC_URL                 = var.rpc_url
    AGENT_VAULT_ADDRESS     = var.contracts.agent_vault
    ROOM_REGISTRY_ADDRESS   = var.contracts.room_registry
    TRIGGER_REGISTRY_ADDRESS = var.contracts.trigger_registry
    IDENTITY_REGISTRY_ADDRESS = var.contracts.identity_registry
    SERVICE_REGISTRY_ADDRESS = var.contracts.service_registry
    COMPUTE_MARKETPLACE_URL = var.services.compute_marketplace
    STORAGE_API_URL         = var.services.storage_api
    IPFS_GATEWAY            = var.services.ipfs_gateway
    INDEXER_GRAPHQL_URL     = var.services.indexer_graphql
  }
}

# API Deployment
resource "kubernetes_deployment" "api" {
  metadata {
    name      = "crucible-api"
    namespace = kubernetes_namespace.crucible.metadata[0].name
    labels = {
      app       = "crucible-api"
      component = "api"
    }
  }

  spec {
    replicas = var.replicas.api

    selector {
      match_labels = {
        app       = "crucible-api"
        component = "api"
      }
    }

    template {
      metadata {
        labels = {
          app       = "crucible-api"
          component = "api"
        }
      }

      spec {
        container {
          name  = "api"
          image = "${var.ecr_repository_url}:latest"

          port {
            container_port = 4020
            name           = "http"
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.crucible_config.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.crucible_secrets.metadata[0].name
            }
          }

          env {
            name  = "PORT"
            value = "4020"
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = 4020
            }
            initial_delay_seconds = 10
            period_seconds        = 30
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = 4020
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }
        }
      }
    }
  }
}

# API Service
resource "kubernetes_service" "api" {
  metadata {
    name      = "crucible-api"
    namespace = kubernetes_namespace.crucible.metadata[0].name
  }

  spec {
    selector = {
      app       = "crucible-api"
      component = "api"
    }

    port {
      port        = 80
      target_port = 4020
      name        = "http"
    }

    type = "ClusterIP"
  }
}

# Executor Deployment
resource "kubernetes_deployment" "executor" {
  metadata {
    name      = "crucible-executor"
    namespace = kubernetes_namespace.crucible.metadata[0].name
    labels = {
      app       = "crucible-executor"
      component = "executor"
    }
  }

  spec {
    replicas = var.replicas.executor

    selector {
      match_labels = {
        app       = "crucible-executor"
        component = "executor"
      }
    }

    template {
      metadata {
        labels = {
          app       = "crucible-executor"
          component = "executor"
        }
      }

      spec {
        container {
          name    = "executor"
          image   = "${var.ecr_repository_url}:latest"
          command = ["bun", "run", "executor"]

          env_from {
            config_map_ref {
              name = kubernetes_config_map.crucible_config.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.crucible_secrets.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "200m"
              memory = "512Mi"
            }
            limits = {
              cpu    = "1000m"
              memory = "1Gi"
            }
          }
        }
      }
    }
  }
}

# Ingress (if using ALB ingress controller)
resource "kubernetes_ingress_v1" "api" {
  count = var.environment != "localnet" ? 1 : 0

  metadata {
    name      = "crucible-api-ingress"
    namespace = kubernetes_namespace.crucible.metadata[0].name
    annotations = {
      "kubernetes.io/ingress.class"           = "alb"
      "alb.ingress.kubernetes.io/scheme"      = "internet-facing"
      "alb.ingress.kubernetes.io/target-type" = "ip"
    }
  }

  spec {
    rule {
      host = var.environment == "mainnet" ? "crucible.jeju.network" : "${var.environment}-crucible.jeju.network"
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service.api.metadata[0].name
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}

# Outputs
output "namespace" {
  description = "Kubernetes namespace"
  value       = kubernetes_namespace.crucible.metadata[0].name
}

output "api_service_name" {
  description = "API service name"
  value       = kubernetes_service.api.metadata[0].name
}

output "api_endpoint" {
  description = "API endpoint within cluster"
  value       = "http://${kubernetes_service.api.metadata[0].name}.${kubernetes_namespace.crucible.metadata[0].name}.svc.cluster.local"
}
