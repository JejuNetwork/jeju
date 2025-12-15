# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Artifact Registry Module

variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

locals {
  name_prefix = "jeju-${var.environment}"
  repositories = [
    "op-node",
    "op-geth",
    "op-batcher",
    "op-proposer",
    "gateway",
    "bundler",
    "crucible",
    "subsquid",
    "messaging"
  ]
}

resource "google_artifact_registry_repository" "repos" {
  for_each = toset(local.repositories)

  project       = var.project_id
  location      = var.region
  repository_id = "${local.name_prefix}-${each.key}"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }
}

output "repository_urls" {
  value = {
    for name, repo in google_artifact_registry_repository.repos :
    name => "${var.region}-docker.pkg.dev/${var.project_id}/${repo.repository_id}"
  }
}

