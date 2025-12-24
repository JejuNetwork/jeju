# Outputs for Farcaster Hub module

output "hub_url" {
  description = "Farcaster Hub HTTP URL (HTTPS via ingress)"
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
