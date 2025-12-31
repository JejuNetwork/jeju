# Outputs for EVM Chain Module
# These are used by parent modules to configure DWS RPC marketplace

output "chain_config" {
  description = "Complete chain configuration for DWS registration"
  value = {
    chainId            = var.chain_id
    chainName          = var.chain_name
    stackType          = var.stack_type
    internalRpcUrl     = local.internal_rpc_endpoint
    internalWsUrl      = local.internal_ws_endpoint
    externalRpcUrl     = var.enable_external_access && var.domain_name != "" ? "https://rpc.${var.chain_name}.${var.environment}.${var.domain_name}" : null
    namespace          = kubernetes_namespace.chain.metadata[0].name
    isL2               = var.stack_type == "op-stack" || var.stack_type == "nitro"
    l1ChainId          = var.l1_chain_id
  }
}
