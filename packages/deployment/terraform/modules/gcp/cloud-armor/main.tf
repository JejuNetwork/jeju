# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Cloud Armor Module - WAF

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "enabled" {
  type    = bool
  default = true
}

variable "rate_limit_requests" {
  type    = number
  default = 2000
}

variable "rate_limit_interval" {
  type    = number
  default = 60
}

locals {
  name_prefix = "jeju-${var.environment}"
}

resource "google_compute_security_policy" "main" {
  count   = var.enabled ? 1 : 0
  name    = "${local.name_prefix}-security-policy"
  project = var.project_id

  # Default rule
  rule {
    action   = "allow"
    priority = "2147483647"
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
    priority = "1000"
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
        count        = var.rate_limit_requests
        interval_sec = var.rate_limit_interval
      }
      ban_duration_sec = 300
    }
    description = "Rate limiting"
  }

  # Block common attack patterns
  rule {
    action   = "deny(403)"
    priority = "100"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-stable')"
      }
    }
    description = "SQL injection protection"
  }

  rule {
    action   = "deny(403)"
    priority = "101"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-stable')"
      }
    }
    description = "XSS protection"
  }

  rule {
    action   = "deny(403)"
    priority = "102"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rce-stable')"
      }
    }
    description = "Remote code execution protection"
  }

  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }
}

output "policy_id" {
  value = var.enabled ? google_compute_security_policy.main[0].id : null
}

output "policy_name" {
  value = var.enabled ? google_compute_security_policy.main[0].name : null
}

