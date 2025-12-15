# GCP Cloud SQL Module - PostgreSQL for Jeju
# Equivalent to AWS RDS module

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

variable "network_id" {
  description = "VPC network ID"
  type        = string
}

variable "tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-custom-2-4096" # 2 vCPU, 4GB RAM
}

variable "disk_size" {
  description = "Disk size in GB"
  type        = number
  default     = 100
}

variable "database_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "POSTGRES_15"
}

variable "high_availability" {
  description = "Enable high availability"
  type        = bool
  default     = true
}

variable "backup_enabled" {
  description = "Enable automated backups"
  type        = bool
  default     = true
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# Private service connection for Cloud SQL
resource "google_compute_global_address" "private_ip" {
  name          = "${local.name_prefix}-sql-ip"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = var.network_id
}

resource "google_service_networking_connection" "private" {
  network                 = var.network_id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# Cloud SQL Instance
resource "google_sql_database_instance" "main" {
  name             = "${local.name_prefix}-postgres"
  project          = var.project_id
  region           = var.region
  database_version = var.database_version

  depends_on = [google_service_networking_connection.private]

  settings {
    tier              = var.tier
    disk_size         = var.disk_size
    disk_type         = "PD_SSD"
    disk_autoresize   = true
    availability_type = var.high_availability ? "REGIONAL" : "ZONAL"

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
    }

    backup_configuration {
      enabled                        = var.backup_enabled
      start_time                     = "03:00"
      point_in_time_recovery_enabled = var.environment == "mainnet"
      backup_retention_settings {
        retained_backups = var.environment == "mainnet" ? 30 : 7
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 3
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = false
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

  deletion_protection = var.environment == "mainnet"
}

# Default database
resource "google_sql_database" "main" {
  name     = "jeju"
  project  = var.project_id
  instance = google_sql_database_instance.main.name
}

# Database user
resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "main" {
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

output "instance_name" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "Cloud SQL connection name (for Cloud SQL Proxy)"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  description = "Private IP address"
  value       = google_sql_database_instance.main.private_ip_address
}

output "database_name" {
  description = "Database name"
  value       = google_sql_database.main.name
}

output "database_user" {
  description = "Database user"
  value       = google_sql_user.main.name
}

output "password_secret_id" {
  description = "Secret Manager secret ID for database password"
  value       = google_secret_manager_secret.db_password.secret_id
}
