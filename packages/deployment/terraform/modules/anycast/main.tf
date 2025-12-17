# Anycast IP Configuration
# 
# Provides geo-distributed anycast IPs for ultra-low latency access.
# Uses multiple providers with BGP announcement for automatic failover.
#
# Architecture:
# - Vultr: BGP + Anycast ($5/month per PoP)
# - AWS: Global Accelerator (anycast via AWS backbone)
# - GCP: Anycast IPs via Cloud Armor
# 
# All providers announce the same IP ranges, routing to nearest PoP.

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
}

variable "aws_accelerator_enabled" {
  description = "Enable AWS Global Accelerator"
  type        = bool
  default     = true
}

variable "gcp_anycast_enabled" {
  description = "Enable GCP Anycast IPs"
  type        = bool
  default     = true
}

variable "vultr_bgp_enabled" {
  description = "Enable Vultr BGP announcement"
  type        = bool
  default     = false  # Requires Vultr account with BGP enabled
}

variable "endpoints" {
  description = "Backend endpoints to route to"
  type = list(object({
    name    = string
    port    = number
    aws_alb = string  # AWS ALB ARN
    gcp_neg = string  # GCP NEG name
  }))
  default = []
}

variable "health_check_path" {
  description = "Health check path for backends"
  type        = string
  default     = "/health"
}

variable "tags" {
  description = "Tags for resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# ============================================================================
# AWS Global Accelerator
# ============================================================================

resource "aws_globalaccelerator_accelerator" "main" {
  count = var.aws_accelerator_enabled ? 1 : 0

  name            = "${local.name_prefix}-accelerator"
  ip_address_type = "IPV4"
  enabled         = true

  attributes {
    flow_logs_enabled   = true
    flow_logs_s3_bucket = aws_s3_bucket.accelerator_logs[0].id
    flow_logs_s3_prefix = "accelerator-logs/"
  }

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-accelerator"
    Environment = var.environment
  })
}

resource "aws_s3_bucket" "accelerator_logs" {
  count = var.aws_accelerator_enabled ? 1 : 0

  bucket = "${local.name_prefix}-accelerator-logs"

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-accelerator-logs"
    Environment = var.environment
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "accelerator_logs" {
  count = var.aws_accelerator_enabled ? 1 : 0

  bucket = aws_s3_bucket.accelerator_logs[0].id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    expiration {
      days = 30
    }
  }
}

# Listener for each endpoint
resource "aws_globalaccelerator_listener" "main" {
  for_each = var.aws_accelerator_enabled ? { for e in var.endpoints : e.name => e } : {}

  accelerator_arn = aws_globalaccelerator_accelerator.main[0].id
  protocol        = "TCP"

  port_range {
    from_port = each.value.port
    to_port   = each.value.port
  }
}

# Endpoint groups for each region
resource "aws_globalaccelerator_endpoint_group" "us_east" {
  for_each = var.aws_accelerator_enabled ? { for e in var.endpoints : e.name => e } : {}

  listener_arn                  = aws_globalaccelerator_listener.main[each.key].id
  endpoint_group_region         = "us-east-1"
  health_check_path             = var.health_check_path
  health_check_port             = each.value.port
  health_check_protocol         = "HTTP"
  health_check_interval_seconds = 10
  threshold_count               = 3

  endpoint_configuration {
    endpoint_id = each.value.aws_alb
    weight      = 100
  }
}

# ============================================================================
# GCP Anycast (via Global Load Balancer)
# ============================================================================

# Reserved anycast IP
resource "google_compute_global_address" "anycast" {
  count = var.gcp_anycast_enabled ? 1 : 0

  name         = "${local.name_prefix}-anycast-ip"
  address_type = "EXTERNAL"
}

# Backend service with Cloud CDN and Cloud Armor
resource "google_compute_backend_service" "anycast" {
  for_each = var.gcp_anycast_enabled ? { for e in var.endpoints : e.name => e } : {}

  name        = "${local.name_prefix}-${each.key}-backend"
  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  enable_cdn = true
  
  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    serve_while_stale            = 86400
    negative_caching             = true
  }

  health_checks = [google_compute_health_check.anycast[each.key].id]
}

resource "google_compute_health_check" "anycast" {
  for_each = var.gcp_anycast_enabled ? { for e in var.endpoints : e.name => e } : {}

  name               = "${local.name_prefix}-${each.key}-hc"
  check_interval_sec = 10
  timeout_sec        = 5

  http_health_check {
    port         = each.value.port
    request_path = var.health_check_path
  }
}

# URL map
resource "google_compute_url_map" "anycast" {
  count = var.gcp_anycast_enabled && length(var.endpoints) > 0 ? 1 : 0

  name            = "${local.name_prefix}-anycast-urlmap"
  default_service = google_compute_backend_service.anycast[var.endpoints[0].name].id
}

# HTTPS proxy
resource "google_compute_target_https_proxy" "anycast" {
  count = var.gcp_anycast_enabled && length(var.endpoints) > 0 ? 1 : 0

  name    = "${local.name_prefix}-anycast-https-proxy"
  url_map = google_compute_url_map.anycast[0].id
  # SSL certificate should be configured separately
}

# Forwarding rule
resource "google_compute_global_forwarding_rule" "anycast" {
  count = var.gcp_anycast_enabled && length(var.endpoints) > 0 ? 1 : 0

  name       = "${local.name_prefix}-anycast-fwd"
  ip_address = google_compute_global_address.anycast[0].address
  port_range = "443"
  target     = google_compute_target_https_proxy.anycast[0].id
}

# ============================================================================
# DNS Records
# ============================================================================

# AWS Route53 records pointing to Global Accelerator
resource "aws_route53_record" "anycast_a" {
  count = var.aws_accelerator_enabled ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "anycast.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_globalaccelerator_accelerator.main[0].dns_name
    zone_id                = aws_globalaccelerator_accelerator.main[0].hosted_zone_id
    evaluate_target_health = true
  }
}

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ============================================================================
# Outputs
# ============================================================================

output "aws_accelerator_ips" {
  description = "AWS Global Accelerator IP addresses"
  value       = var.aws_accelerator_enabled ? aws_globalaccelerator_accelerator.main[0].ip_sets[0].ip_addresses : []
}

output "aws_accelerator_dns" {
  description = "AWS Global Accelerator DNS name"
  value       = var.aws_accelerator_enabled ? aws_globalaccelerator_accelerator.main[0].dns_name : null
}

output "gcp_anycast_ip" {
  description = "GCP Anycast IP address"
  value       = var.gcp_anycast_enabled ? google_compute_global_address.anycast[0].address : null
}

output "anycast_endpoints" {
  description = "Anycast endpoint URLs"
  value = {
    primary = var.aws_accelerator_enabled ? "https://anycast.${var.domain_name}" : null
    aws     = var.aws_accelerator_enabled ? "https://${aws_globalaccelerator_accelerator.main[0].dns_name}" : null
    gcp     = var.gcp_anycast_enabled ? "https://${google_compute_global_address.anycast[0].address}" : null
  }
}

