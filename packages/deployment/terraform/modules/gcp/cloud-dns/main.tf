# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Cloud DNS Module

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "domain_name" {
  type = string
}

variable "create_zone" {
  type    = bool
  default = true
}

variable "enable_local_dns" {
  description = "Enable local development DNS (*.local.domain -> 127.0.0.1)"
  type        = bool
  default     = true
}

locals {
  name_prefix = "jeju-${var.environment}"
  dns_name    = "${var.domain_name}."
}

# Managed Zone
resource "google_dns_managed_zone" "main" {
  count       = var.create_zone ? 1 : 0
  name        = "${local.name_prefix}-zone"
  project     = var.project_id
  dns_name    = local.dns_name
  description = "Jeju ${var.environment} DNS zone"

  dnssec_config {
    state = "on"
  }
}

data "google_dns_managed_zone" "existing" {
  count   = var.create_zone ? 0 : 1
  name    = "${local.name_prefix}-zone"
  project = var.project_id
}

locals {
  zone_name = var.create_zone ? google_dns_managed_zone.main[0].name : data.google_dns_managed_zone.existing[0].name
  zone_id   = var.create_zone ? google_dns_managed_zone.main[0].id : data.google_dns_managed_zone.existing[0].id
}

# =============================================================================
# LOCAL DEVELOPMENT DNS
# Points *.local.domain to 127.0.0.1 for zero-config local development
# =============================================================================
resource "google_dns_record_set" "local_wildcard" {
  count        = var.enable_local_dns ? 1 : 0
  name         = "*.local.${local.dns_name}"
  type         = "A"
  ttl          = 300
  managed_zone = local.zone_name
  project      = var.project_id
  rrdatas      = ["127.0.0.1"]
}

resource "google_dns_record_set" "local_root" {
  count        = var.enable_local_dns ? 1 : 0
  name         = "local.${local.dns_name}"
  type         = "A"
  ttl          = 300
  managed_zone = local.zone_name
  project      = var.project_id
  rrdatas      = ["127.0.0.1"]
}

output "zone_name" {
  value = local.zone_name
}

output "zone_id" {
  value = local.zone_id
}

output "nameservers" {
  value = var.create_zone ? google_dns_managed_zone.main[0].name_servers : data.google_dns_managed_zone.existing[0].name_servers
}

output "dns_name" {
  value = local.dns_name
}

output "local_dev_urls" {
  description = "Local development URLs"
  value = var.enable_local_dns ? {
    gateway  = "http://gateway.local.${var.domain_name}"
    bazaar   = "http://bazaar.local.${var.domain_name}"
    docs     = "http://docs.local.${var.domain_name}"
    indexer  = "http://indexer.local.${var.domain_name}"
    rpc      = "http://rpc.local.${var.domain_name}"
    crucible = "http://crucible.local.${var.domain_name}"
  } : {}
}

