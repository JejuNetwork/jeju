# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Storage CDN Module - Decentralized storage gateway with Cloud CDN
# Provides parity with AWS storage-cdn.tf module

variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "environment" {
  type        = string
  description = "Environment name (localnet, testnet, mainnet)"
}

variable "region" {
  type        = string
  description = "GCP region"
  default     = "us-central1"
}

variable "domain_name" {
  type        = string
  description = "Base domain name for CDN"
}

variable "enable_storage_cdn" {
  type        = bool
  description = "Enable storage CDN gateway"
  default     = true
}

variable "storage_gateway_origin" {
  type        = string
  description = "Origin URL for storage gateway"
  default     = "gateway.jeju.network"
}

variable "jns_resolver_origin" {
  type        = string
  description = "JNS resolver API endpoint"
  default     = "jns-resolver.jeju.network"
}

variable "cache_ttl_default" {
  type        = number
  description = "Default cache TTL in seconds"
  default     = 86400 # 1 day
}

variable "cache_ttl_immutable" {
  type        = number
  description = "TTL for immutable content (IPFS CIDs)"
  default     = 31536000 # 1 year
}

variable "enable_waf" {
  type        = bool
  description = "Enable Cloud Armor WAF"
  default     = true
}

variable "ssl_certificate_name" {
  type        = string
  description = "Name of the managed SSL certificate"
  default     = ""
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# ==============================================================================
# Cloud Storage Bucket for Cache
# ==============================================================================

resource "google_storage_bucket" "storage_cache" {
  count = var.enable_storage_cdn ? 1 : 0

  name          = "${local.name_prefix}-storage-cache"
  project       = var.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  # Lifecycle rules for cache management
  lifecycle_rule {
    condition {
      age = 30  # Expire cached content after 30 days
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      matches_prefix = ["pinned/"]
      age            = 0  # Never expire pinned content
    }
    action {
      type = "SetStorageClass"
      storage_class = "STANDARD"
    }
  }

  labels = {
    environment = var.environment
    service     = "storage-cdn"
  }
}

# ==============================================================================
# Backend Bucket for CDN
# ==============================================================================

resource "google_compute_backend_bucket" "storage_cache" {
  count = var.enable_storage_cdn ? 1 : 0

  name        = "${local.name_prefix}-storage-cache-backend"
  project     = var.project_id
  bucket_name = google_storage_bucket.storage_cache[0].name
  
  enable_cdn = true

  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = var.cache_ttl_default
    max_ttl           = var.cache_ttl_immutable
    client_ttl        = var.cache_ttl_default
    negative_caching  = true
    serve_while_stale = 86400

    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = false
    }
  }
}

# ==============================================================================
# Static IP for Load Balancer
# ==============================================================================

resource "google_compute_global_address" "storage_cdn" {
  count = var.enable_storage_cdn ? 1 : 0

  name         = "${local.name_prefix}-storage-cdn-ip"
  project      = var.project_id
  address_type = "EXTERNAL"
}

# ==============================================================================
# Health Checks
# ==============================================================================

resource "google_compute_health_check" "storage_gateway" {
  count = var.enable_storage_cdn ? 1 : 0

  name    = "${local.name_prefix}-storage-gateway-hc"
  project = var.project_id

  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 443
    request_path = "/health"
  }
}

resource "google_compute_health_check" "jns_resolver" {
  count = var.enable_storage_cdn ? 1 : 0

  name    = "${local.name_prefix}-jns-resolver-hc"
  project = var.project_id

  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 443
    request_path = "/health"
  }
}

# ==============================================================================
# Network Endpoint Groups (Internet NEGs for external origins)
# ==============================================================================

resource "google_compute_global_network_endpoint_group" "storage_gateway" {
  count = var.enable_storage_cdn ? 1 : 0

  name                  = "${local.name_prefix}-storage-gateway-neg"
  project               = var.project_id
  network_endpoint_type = "INTERNET_FQDN_PORT"
  default_port          = 443
}

resource "google_compute_global_network_endpoint" "storage_gateway" {
  count = var.enable_storage_cdn ? 1 : 0

  global_network_endpoint_group = google_compute_global_network_endpoint_group.storage_gateway[0].id
  fqdn                          = var.storage_gateway_origin
  port                          = 443
}

resource "google_compute_global_network_endpoint_group" "jns_resolver" {
  count = var.enable_storage_cdn ? 1 : 0

  name                  = "${local.name_prefix}-jns-resolver-neg"
  project               = var.project_id
  network_endpoint_type = "INTERNET_FQDN_PORT"
  default_port          = 443
}

resource "google_compute_global_network_endpoint" "jns_resolver" {
  count = var.enable_storage_cdn ? 1 : 0

  global_network_endpoint_group = google_compute_global_network_endpoint_group.jns_resolver[0].id
  fqdn                          = var.jns_resolver_origin
  port                          = 443
}

# ==============================================================================
# Backend Services
# ==============================================================================

resource "google_compute_backend_service" "storage_gateway" {
  count = var.enable_storage_cdn ? 1 : 0

  name        = "${local.name_prefix}-storage-gateway-backend"
  project     = var.project_id
  protocol    = "HTTPS"
  timeout_sec = 60

  health_checks = [google_compute_health_check.storage_gateway[0].id]

  enable_cdn = true

  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    default_ttl       = var.cache_ttl_default
    max_ttl           = var.cache_ttl_immutable
    client_ttl        = var.cache_ttl_default
    negative_caching  = true
    serve_while_stale = 86400

    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = false
    }
  }

  dynamic "security_policy" {
    for_each = var.enable_waf ? [1] : []
    content {
      policy = google_compute_security_policy.storage_waf[0].id
    }
  }

  backend {
    group = google_compute_global_network_endpoint_group.storage_gateway[0].id
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "mainnet" ? 0.1 : 1.0
  }
}

resource "google_compute_backend_service" "jns_resolver" {
  count = var.enable_storage_cdn ? 1 : 0

  name        = "${local.name_prefix}-jns-resolver-backend"
  project     = var.project_id
  protocol    = "HTTPS"
  timeout_sec = 30

  health_checks = [google_compute_health_check.jns_resolver[0].id]

  enable_cdn = true

  cdn_policy {
    cache_mode  = "CACHE_ALL_STATIC"
    default_ttl = 60  # JNS records can change
    max_ttl     = 300
    client_ttl  = 60
  }

  dynamic "security_policy" {
    for_each = var.enable_waf ? [1] : []
    content {
      policy = google_compute_security_policy.storage_waf[0].id
    }
  }

  backend {
    group = google_compute_global_network_endpoint_group.jns_resolver[0].id
  }
}

# ==============================================================================
# URL Map with Path-Based Routing
# ==============================================================================

resource "google_compute_url_map" "storage_cdn" {
  count = var.enable_storage_cdn ? 1 : 0

  name            = "${local.name_prefix}-storage-cdn-urlmap"
  project         = var.project_id
  default_service = google_compute_backend_service.storage_gateway[0].id

  host_rule {
    hosts        = ["ipfs.${var.domain_name}", "storage.${var.domain_name}"]
    path_matcher = "storage"
  }

  host_rule {
    hosts        = ["*.jns.${var.domain_name}"]
    path_matcher = "jns"
  }

  # Storage path matcher
  path_matcher {
    name            = "storage"
    default_service = google_compute_backend_service.storage_gateway[0].id

    # IPFS content - immutable caching (1 year)
    path_rule {
      paths   = ["/ipfs/*"]
      service = google_compute_backend_service.storage_gateway[0].id
      route_action {
        cdn_policy {
          cache_mode  = "FORCE_CACHE_ALL"
          default_ttl = var.cache_ttl_immutable
        }
      }
    }

    # IPNS names - shorter cache (5 minutes)
    path_rule {
      paths   = ["/ipns/*"]
      service = google_compute_backend_service.storage_gateway[0].id
      route_action {
        cdn_policy {
          cache_mode  = "CACHE_ALL_STATIC"
          default_ttl = 300
        }
      }
    }

    # WebTorrent magnet links
    path_rule {
      paths   = ["/torrent/*", "/magnet/*"]
      service = google_compute_backend_service.storage_gateway[0].id
      route_action {
        cdn_policy {
          cache_mode  = "CACHE_ALL_STATIC"
          default_ttl = 3600
        }
      }
    }

    # API routes - no caching
    path_rule {
      paths   = ["/api/*"]
      service = google_compute_backend_service.storage_gateway[0].id
      route_action {
        cdn_policy {
          cache_mode = "BYPASS_CACHE"
        }
      }
    }

    # Static assets with hash - immutable
    path_rule {
      paths   = ["/assets/*", "/_next/static/*"]
      service = google_compute_backend_service.storage_gateway[0].id
      route_action {
        cdn_policy {
          cache_mode  = "FORCE_CACHE_ALL"
          default_ttl = var.cache_ttl_immutable
        }
      }
    }
  }

  # JNS path matcher
  path_matcher {
    name            = "jns"
    default_service = google_compute_backend_service.jns_resolver[0].id

    path_rule {
      paths   = ["/*"]
      service = google_compute_backend_service.jns_resolver[0].id
    }
  }
}

# ==============================================================================
# HTTPS Proxy
# ==============================================================================

resource "google_compute_target_https_proxy" "storage_cdn" {
  count = var.enable_storage_cdn ? 1 : 0

  name             = "${local.name_prefix}-storage-cdn-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.storage_cdn[0].id
  ssl_certificates = var.ssl_certificate_name != "" ? [var.ssl_certificate_name] : []
}

# ==============================================================================
# HTTP to HTTPS Redirect
# ==============================================================================

resource "google_compute_url_map" "https_redirect" {
  count = var.enable_storage_cdn ? 1 : 0

  name    = "${local.name_prefix}-storage-https-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = var.enable_storage_cdn ? 1 : 0

  name    = "${local.name_prefix}-storage-http-redirect-proxy"
  project = var.project_id
  url_map = google_compute_url_map.https_redirect[0].id
}

# ==============================================================================
# Global Forwarding Rules
# ==============================================================================

resource "google_compute_global_forwarding_rule" "https" {
  count = var.enable_storage_cdn ? 1 : 0

  name       = "${local.name_prefix}-storage-cdn-https"
  project    = var.project_id
  ip_address = google_compute_global_address.storage_cdn[0].address
  port_range = "443"
  target     = google_compute_target_https_proxy.storage_cdn[0].id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  count = var.enable_storage_cdn ? 1 : 0

  name       = "${local.name_prefix}-storage-cdn-http-redirect"
  project    = var.project_id
  ip_address = google_compute_global_address.storage_cdn[0].address
  port_range = "80"
  target     = google_compute_target_http_proxy.redirect[0].id
}

# ==============================================================================
# Cloud Armor Security Policy (WAF)
# ==============================================================================

resource "google_compute_security_policy" "storage_waf" {
  count = var.enable_storage_cdn && var.enable_waf ? 1 : 0

  name    = "${local.name_prefix}-storage-waf"
  project = var.project_id

  # Adaptive DDoS protection
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

  # Rate limiting - 1000 req/min per IP
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

  # Higher rate limit for IPFS immutable content
  rule {
    action   = "rate_based_ban"
    priority = 900
    match {
      expr {
        expression = "request.path.matches('/ipfs/.*')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 5000
        interval_sec = 60
      }
      ban_duration_sec = 60
    }
    description = "Higher rate limit for IPFS content"
  }

  # XSS protection
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

  # SQL injection protection
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

  # Block scanners
  rule {
    action   = "deny(403)"
    priority = 300
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('scannerdetection-stable')"
      }
    }
    description = "Block vulnerability scanners"
  }

  # Block protocol attacks
  rule {
    action   = "deny(403)"
    priority = 301
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('protocolattack-stable')"
      }
    }
    description = "Block protocol attacks"
  }
}

# ==============================================================================
# Cloud DNS Records
# ==============================================================================

resource "google_dns_record_set" "ipfs" {
  count = var.enable_storage_cdn ? 1 : 0

  name         = "ipfs.${var.domain_name}."
  managed_zone = "${local.name_prefix}-zone"
  project      = var.project_id
  type         = "A"
  ttl          = 300

  rrdatas = [google_compute_global_address.storage_cdn[0].address]
}

resource "google_dns_record_set" "storage" {
  count = var.enable_storage_cdn ? 1 : 0

  name         = "storage.${var.domain_name}."
  managed_zone = "${local.name_prefix}-zone"
  project      = var.project_id
  type         = "A"
  ttl          = 300

  rrdatas = [google_compute_global_address.storage_cdn[0].address]
}

resource "google_dns_record_set" "jns_wildcard" {
  count = var.enable_storage_cdn ? 1 : 0

  name         = "*.jns.${var.domain_name}."
  managed_zone = "${local.name_prefix}-zone"
  project      = var.project_id
  type         = "A"
  ttl          = 300

  rrdatas = [google_compute_global_address.storage_cdn[0].address]
}

# ==============================================================================
# Outputs
# ==============================================================================

output "storage_cdn_ip_address" {
  description = "Global IP address for storage CDN"
  value       = var.enable_storage_cdn ? google_compute_global_address.storage_cdn[0].address : null
}

output "storage_cdn_backend_bucket" {
  description = "Backend bucket for storage cache"
  value       = var.enable_storage_cdn ? google_compute_backend_bucket.storage_cache[0].name : null
}

output "storage_cdn_url_map" {
  description = "URL map ID"
  value       = var.enable_storage_cdn ? google_compute_url_map.storage_cdn[0].id : null
}

output "storage_waf_policy_id" {
  description = "Cloud Armor security policy ID"
  value       = var.enable_storage_cdn && var.enable_waf ? google_compute_security_policy.storage_waf[0].id : null
}

output "storage_cdn_urls" {
  description = "Public URLs for storage CDN"
  value = var.enable_storage_cdn ? {
    ipfs    = "https://ipfs.${var.domain_name}"
    storage = "https://storage.${var.domain_name}"
    jns     = "https://*.jns.${var.domain_name}"
  } : null
}


