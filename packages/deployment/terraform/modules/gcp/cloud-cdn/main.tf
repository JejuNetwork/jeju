# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Cloud CDN Module - Global Load Balancer with CDN

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "backends" {
  description = "Backend services to expose via CDN"
  type = list(object({
    name        = string
    port        = number
    health_path = string
    cdn_enabled = bool
    cache_ttl   = number
    neg_name    = string  # Network Endpoint Group name
  }))
  default = []
}

variable "ssl_certificate_name" {
  description = "Name of the managed SSL certificate"
  type        = string
  default     = ""
}

variable "enable_cdn" {
  description = "Enable Cloud CDN on backends"
  type        = bool
  default     = true
}

variable "enable_waf" {
  description = "Enable Cloud Armor WAF"
  type        = bool
  default     = true
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# Static IP for the Global Load Balancer
resource "google_compute_global_address" "cdn" {
  name         = "${local.name_prefix}-cdn-ip"
  project      = var.project_id
  address_type = "EXTERNAL"
}

# Health checks for each backend
resource "google_compute_health_check" "backends" {
  for_each = { for b in var.backends : b.name => b }

  name    = "${local.name_prefix}-${each.key}-hc"
  project = var.project_id

  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = each.value.port
    request_path = each.value.health_path
  }
}

# Backend services with CDN
resource "google_compute_backend_service" "backends" {
  for_each = { for b in var.backends : b.name => b }

  name        = "${local.name_prefix}-${each.key}-backend"
  project     = var.project_id
  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  health_checks = [google_compute_health_check.backends[each.key].id]

  # Cloud CDN configuration
  enable_cdn = var.enable_cdn && each.value.cdn_enabled

  dynamic "cdn_policy" {
    for_each = var.enable_cdn && each.value.cdn_enabled ? [1] : []

    content {
      cache_mode        = "CACHE_ALL_STATIC"
      default_ttl       = each.value.cache_ttl
      max_ttl           = 86400  # 1 day max
      client_ttl        = each.value.cache_ttl
      negative_caching  = true

      # Cache key policy
      cache_key_policy {
        include_host         = true
        include_protocol     = true
        include_query_string = false
      }

      # Serve stale content while revalidating
      serve_while_stale = 86400
    }
  }

  # Connection draining
  connection_draining_timeout_sec = 30

  # Cloud Armor security policy
  dynamic "security_policy" {
    for_each = var.enable_waf ? [1] : []
    content {
      policy = google_compute_security_policy.waf[0].id
    }
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "mainnet" ? 0.1 : 1.0
  }

  # Backend reference - NEG will be attached separately
}

# URL Map for routing
resource "google_compute_url_map" "cdn" {
  name            = "${local.name_prefix}-cdn-urlmap"
  project         = var.project_id
  default_service = length(var.backends) > 0 ? google_compute_backend_service.backends[var.backends[0].name].id : null

  dynamic "host_rule" {
    for_each = { for b in var.backends : b.name => b }

    content {
      hosts        = ["${host_rule.key}.${var.domain_name}"]
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = { for b in var.backends : b.name => b }

    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.backends[path_matcher.key].id

      # IPFS content - immutable caching
      path_rule {
        paths   = ["/ipfs/*"]
        service = google_compute_backend_service.backends[path_matcher.key].id
        route_action {
          cdn_policy {
            cache_mode  = "FORCE_CACHE_ALL"
            default_ttl = 31536000  # 1 year
          }
        }
      }

      # API routes - no caching
      path_rule {
        paths   = ["/api/*"]
        service = google_compute_backend_service.backends[path_matcher.key].id
        route_action {
          cdn_policy {
            cache_mode = "BYPASS_CACHE"
          }
        }
      }

      # Static assets with hash - immutable
      path_rule {
        paths   = ["/assets/*"]
        service = google_compute_backend_service.backends[path_matcher.key].id
        route_action {
          cdn_policy {
            cache_mode  = "FORCE_CACHE_ALL"
            default_ttl = 31536000  # 1 year
          }
        }
      }
    }
  }
}

# HTTPS proxy
resource "google_compute_target_https_proxy" "cdn" {
  name             = "${local.name_prefix}-cdn-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.cdn.id
  ssl_certificates = var.ssl_certificate_name != "" ? [var.ssl_certificate_name] : []
}

# HTTP to HTTPS redirect
resource "google_compute_url_map" "https_redirect" {
  name    = "${local.name_prefix}-https-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${local.name_prefix}-http-redirect-proxy"
  project = var.project_id
  url_map = google_compute_url_map.https_redirect.id
}

# Global forwarding rules
resource "google_compute_global_forwarding_rule" "https" {
  name       = "${local.name_prefix}-cdn-https"
  project    = var.project_id
  ip_address = google_compute_global_address.cdn.address
  port_range = "443"
  target     = google_compute_target_https_proxy.cdn.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name       = "${local.name_prefix}-cdn-http-redirect"
  project    = var.project_id
  ip_address = google_compute_global_address.cdn.address
  port_range = "80"
  target     = google_compute_target_http_proxy.redirect.id
}

# Cloud Armor security policy
resource "google_compute_security_policy" "waf" {
  count   = var.enable_waf ? 1 : 0
  name    = "${local.name_prefix}-waf"
  project = var.project_id

  # DDoS protection
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }

  # Default rule - allow
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  # Rate limiting
  rule {
    action   = "rate_based_ban"
    priority = 1000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 1000
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
    description = "Rate limiting - 1000 req/min per IP"
  }

  # Block known bad actors (placeholder - update with real IPs)
  rule {
    action   = "deny(403)"
    priority = 100
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["192.0.2.0/24"]  # Example blocked range
      }
    }
    description = "Block known bad actors"
  }

  # OWASP rules
  rule {
    action   = "deny(403)"
    priority = 200
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-stable')"
      }
    }
    description = "XSS protection"
  }

  rule {
    action   = "deny(403)"
    priority = 201
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-stable')"
      }
    }
    description = "SQL injection protection"
  }
}

# Outputs
output "cdn_ip_address" {
  description = "Global IP address for the CDN"
  value       = google_compute_global_address.cdn.address
}

output "backend_services" {
  description = "Backend service IDs"
  value       = { for k, v in google_compute_backend_service.backends : k => v.id }
}

output "url_map_id" {
  description = "URL map ID"
  value       = google_compute_url_map.cdn.id
}

output "security_policy_id" {
  description = "Cloud Armor security policy ID"
  value       = var.enable_waf ? google_compute_security_policy.waf[0].id : null
}

