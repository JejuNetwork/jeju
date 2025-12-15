# SPDX-FileCopyrightText: © 2025 Jeju Network
# SPDX-License-Identifier: Apache-2.0
# GCP Cloud SQL Module - PostgreSQL

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

variable "vpc_id" {
  type = string
}

variable "tier" {
  type    = string
  default = "db-custom-2-4096" # 2 vCPU, 4GB RAM
}

variable "disk_size_gb" {
  type    = number
  default = 100
}

variable "disk_autoresize" {
  type    = bool
  default = true
}

variable "disk_autoresize_limit" {
  type    = number
  default = 500
}

variable "availability_type" {
  type    = string
  default = "REGIONAL" # HA
}

variable "backup_enabled" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "database_version" {
  type    = string
  default = "POSTGRES_15"
}

variable "private_service_connection_id" {
  description = "ID of the private service connection (for dependency ordering)"
  type        = string
  default     = ""
}

locals {
  name_prefix = "jeju-${var.environment}"
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

# Cloud SQL Instance
resource "google_sql_database_instance" "main" {
  name             = "${local.name_prefix}-postgres"
  project          = var.project_id
  region           = var.region
  database_version = var.database_version

  deletion_protection = var.environment == "mainnet" ? true : false

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_size         = var.disk_size_gb
    disk_type         = "PD_SSD"
    disk_autoresize   = var.disk_autoresize

    disk_autoresize_limit = var.disk_autoresize_limit

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_id
    }

    backup_configuration {
      enabled                        = var.backup_enabled
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = var.backup_retention_days
      }
      transaction_log_retention_days = 7
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 4 # 4 AM
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_plans_per_minute  = 5
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    database_flags {
      name  = "max_connections"
      value = "500"
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000" # Log queries > 1s
    }
  }
}

# Databases
resource "google_sql_database" "indexer" {
  name     = "indexer"
  project  = var.project_id
  instance = google_sql_database_instance.main.name
}

resource "google_sql_database" "leaderboard" {
  name     = "leaderboard"
  project  = var.project_id
  instance = google_sql_database_instance.main.name
}

resource "google_sql_database" "subsquid" {
  name     = "subsquid"
  project  = var.project_id
  instance = google_sql_database_instance.main.name
}

# Users
resource "google_sql_user" "app" {
  name     = "jeju"
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}

# Store password in Secret Manager
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${local.name_prefix}-db-password"
  project   = var.project_id

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# Outputs
output "instance_name" {
  value = google_sql_database_instance.main.name
}

output "connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  value = google_sql_database_instance.main.private_ip_address
}

output "db_user" {
  value = google_sql_user.app.name
}

output "db_password_secret" {
  value = google_secret_manager_secret.db_password.id
}

output "databases" {
  value = {
    indexer     = google_sql_database.indexer.name
    leaderboard = google_sql_database.leaderboard.name
    subsquid    = google_sql_database.subsquid.name
  }
}

