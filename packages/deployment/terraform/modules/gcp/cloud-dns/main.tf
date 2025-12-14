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

