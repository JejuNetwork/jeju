# =============================================================================
# Multi-Chain RPC Node Deployment for Testnet
# =============================================================================
# Deploys RPC nodes for all supported chains and registers them with DWS
# marketplace for decentralized RPC access.
#
# Chains deployed:
# - Ethereum Sepolia (L1)
# - Base Sepolia (L2)
# - Optimism Sepolia (L2) 
# - Arbitrum Sepolia (L2)
# - BSC Testnet (L1)
# - Solana Devnet (via separate module)
# =============================================================================

locals {
  # Chain configurations for testnet
  testnet_chains = {
    ethereum-sepolia = {
      chain_id     = 11155111
      chain_name   = "ethereum-sepolia"
      stack_type   = "ethereum"
      namespace    = "l1"
      image_repo   = "ethereum/client-go"
      image_tag    = "v1.14.11"
      consensus_repo = "sigp/lighthouse"
      consensus_tag  = "v6.0.1"
      storage_size = "300Gi"
      cpu_request  = "2000m"
      memory_request = "8Gi"
      network_name = "sepolia"
    }
    
    base-sepolia = {
      chain_id     = 84532
      chain_name   = "base-sepolia"
      stack_type   = "op-stack"
      namespace    = "l2-base"
      l1_chain_id  = 11155111
      image_repo   = "us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth"
      image_tag    = "v1.101408.0"
      storage_size = "500Gi"
      cpu_request  = "2000m"
      memory_request = "8Gi"
      network_name = "base-sepolia"
    }
    
    optimism-sepolia = {
      chain_id     = 11155420
      chain_name   = "optimism-sepolia"
      stack_type   = "op-stack"
      namespace    = "l2-optimism"
      l1_chain_id  = 11155111
      image_repo   = "us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth"
      image_tag    = "v1.101408.0"
      storage_size = "500Gi"
      cpu_request  = "2000m"
      memory_request = "8Gi"
      network_name = "op-sepolia"
    }
    
    arbitrum-sepolia = {
      chain_id     = 421614
      chain_name   = "arbitrum-sepolia"
      stack_type   = "nitro"
      namespace    = "l2-arbitrum"
      l1_chain_id  = 11155111
      image_repo   = "offchainlabs/nitro-node"
      image_tag    = "v3.2.1-d81324d"
      storage_size = "500Gi"
      cpu_request  = "4000m"
      memory_request = "16Gi"
      network_name = "arbitrum-sepolia"
    }
    
    bsc-testnet = {
      chain_id     = 97
      chain_name   = "bsc-testnet"
      stack_type   = "bsc"
      namespace    = "l1-bsc"
      image_repo   = "ghcr.io/bnb-chain/bsc"
      image_tag    = "v1.4.15"
      storage_size = "500Gi"
      cpu_request  = "4000m"
      memory_request = "16Gi"
      network_name = "chapel"
    }
  }
}

# Deploy each chain node
module "chain_nodes" {
  source   = "../../modules/evm-chain"
  for_each = var.enable_chain_nodes ? local.testnet_chains : {}
  
  environment        = local.environment
  chain_name         = each.value.chain_name
  chain_id           = each.value.chain_id
  stack_type         = each.value.stack_type
  namespace          = each.value.namespace
  
  # L2-specific
  l1_chain_id        = lookup(each.value, "l1_chain_id", null)
  l1_rpc_endpoint    = lookup(each.value, "l1_chain_id", null) != null ? module.chain_nodes["ethereum-sepolia"].internal_rpc_endpoint : ""
  
  # Node configuration
  image_repository   = each.value.image_repo
  image_tag          = each.value.image_tag
  consensus_image_repository = lookup(each.value, "consensus_repo", "")
  consensus_image_tag = lookup(each.value, "consensus_tag", "")
  network_name       = each.value.network_name
  
  # Resources
  storage_size       = each.value.storage_size
  cpu_request        = each.value.cpu_request
  memory_request     = each.value.memory_request
  
  # External access
  enable_external_access = true
  domain_name        = var.domain_name
  zone_id            = module.route53.zone_id
  acm_certificate_arn = module.acm.certificate_arn
  
  # EKS
  eks_cluster_name   = module.eks.cluster_name
  
  tags = local.common_tags
  
  depends_on = [module.eks]
}

# Solana Devnet - uses module.solana from main.tf (no duplicate)

# Variable to enable/disable chain nodes
variable "enable_chain_nodes" {
  description = "Enable deployment of multi-chain RPC nodes"
  type        = bool
  default     = true
}

# Output all chain endpoints for DWS registration
output "chain_rpc_endpoints" {
  description = "All chain RPC endpoints for DWS marketplace registration"
  value = {
    for name, chain in module.chain_nodes : name => chain.chain_config
  }
}

output "solana_rpc_endpoints" {
  description = "Solana RPC endpoints"
  value = var.enable_solana ? {
    solana-devnet = {
      chainId        = 103
      chainName      = "solana-devnet"
      stackType      = "solana"
      externalRpcUrl = module.solana[0].rpc_endpoint
      externalWsUrl  = module.solana[0].ws_endpoint
    }
  } : {}
}

# Generate ConfigMap with all RPC endpoints for DWS to consume
resource "kubernetes_config_map" "rpc_endpoints" {
  count = var.enable_chain_nodes ? 1 : 0
  
  metadata {
    name      = "dws-rpc-endpoints"
    namespace = "dws"
    labels = {
      "app.kubernetes.io/name"      = "dws-rpc-endpoints"
      "app.kubernetes.io/component" = "config"
    }
  }

  data = {
    "endpoints.json" = jsonencode({
      version     = "1.0.0"
      environment = local.environment
      updatedAt   = timestamp()
      chains = merge(
        {
          for name, chain in module.chain_nodes : name => {
            chainId        = chain.chain_config.chainId
            chainName      = chain.chain_config.chainName
            stackType      = chain.chain_config.stackType
            internalRpcUrl = chain.chain_config.internalRpcUrl
            internalWsUrl  = chain.chain_config.internalWsUrl
            externalRpcUrl = chain.chain_config.externalRpcUrl
            isL2           = chain.chain_config.isL2
            l1ChainId      = chain.chain_config.l1ChainId
            status         = "deployed"
          }
        },
        var.enable_solana ? {
          "solana-devnet" = {
            chainId        = 103
            chainName      = "solana-devnet"
            stackType      = "solana"
            externalRpcUrl = module.solana[0].rpc_endpoint
            externalWsUrl  = module.solana[0].ws_endpoint
            isL2           = false
            status         = "deployed"
          }
        } : {}
      )
    })
  }
  
  depends_on = [module.chain_nodes]
}
