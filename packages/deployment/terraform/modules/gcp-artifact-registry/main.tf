# GCP Artifact Registry Module - Container Registry for Jeju
# Equivalent to AWS ECR module

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (testnet, mainnet)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "repositories" {
  description = "List of repository names to create"
  type        = list(string)
  default = [
    "bazaar",
    "gateway",
    "leaderboard",
    "ipfs",
    "documentation",
    "crucible",
    "indexer-processor",
    "indexer-api",
    "autocrat",
    "eqlite"
  ]
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# Artifact Registry Repository (Docker)
resource "google_artifact_registry_repository" "main" {
  location      = var.region
  repository_id = "${local.name_prefix}-docker"
  project       = var.project_id
  description   = "Docker images for Jeju ${var.environment}"
  format        = "DOCKER"

  docker_config {
    immutable_tags = var.environment == "mainnet"
  }

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }
}

# IAM for GKE to pull images
resource "google_artifact_registry_repository_iam_member" "gke_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.main.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${var.project_id}.svc.id.goog[jeju-apps/default]"
}

output "registry_url" {
  description = "Artifact Registry URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.main.name}"
}

output "repository_name" {
  description = "Repository name"
  value       = google_artifact_registry_repository.main.name
}

output "image_prefix" {
  description = "Prefix for Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.main.name}"
}
