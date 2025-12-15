# GCP GKE Module - Kubernetes Engine for Jeju
# Equivalent to AWS EKS module

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

variable "network_name" {
  description = "VPC network name"
  type        = string
}

variable "subnet_name" {
  description = "Subnet name for GKE"
  type        = string
}

variable "pods_range_name" {
  description = "Secondary range name for pods"
  type        = string
}

variable "services_range_name" {
  description = "Secondary range name for services"
  type        = string
}

variable "cluster_version" {
  description = "GKE cluster version"
  type        = string
  default     = "1.29"
}

variable "node_pools" {
  description = "Node pool configurations"
  type = list(object({
    name          = string
    machine_type  = string
    min_count     = number
    max_count     = number
    disk_size_gb  = number
    disk_type     = string
    preemptible   = bool
    labels        = map(string)
    taints = list(object({
      key    = string
      value  = string
      effect = string
    }))
  }))
  default = [
    {
      name          = "general"
      machine_type  = "e2-standard-4"
      min_count     = 2
      max_count     = 10
      disk_size_gb  = 50
      disk_type     = "pd-standard"
      preemptible   = false
      labels        = { workload = "general" }
      taints        = []
    }
  ]
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# GKE Cluster
resource "google_container_cluster" "main" {
  name     = "${local.name_prefix}-gke"
  project  = var.project_id
  location = var.region

  # Use regional cluster for HA
  network    = var.network_name
  subnetwork = var.subnet_name

  # Private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # IP allocation policy for VPC-native cluster
  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  # Remove default node pool
  remove_default_node_pool = true
  initial_node_count       = 1

  # Cluster features
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Monitoring and logging
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
  }

  # Release channel
  release_channel {
    channel = "REGULAR"
  }

  # Addons
  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    gce_persistent_disk_csi_driver_config {
      enabled = true
    }
  }

  # Maintenance window (Sunday 2-6 AM UTC)
  maintenance_policy {
    recurring_window {
      start_time = "2024-01-01T02:00:00Z"
      end_time   = "2024-01-01T06:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
  }
}

# Node Pools
resource "google_container_node_pool" "pools" {
  for_each = { for pool in var.node_pools : pool.name => pool }

  name       = each.value.name
  project    = var.project_id
  location   = var.region
  cluster    = google_container_cluster.main.name
  node_count = each.value.min_count

  autoscaling {
    min_node_count = each.value.min_count
    max_node_count = each.value.max_count
  }

  node_config {
    machine_type = each.value.machine_type
    disk_size_gb = each.value.disk_size_gb
    disk_type    = each.value.disk_type
    preemptible  = each.value.preemptible

    labels = each.value.labels

    dynamic "taint" {
      for_each = each.value.taints
      content {
        key    = taint.value.key
        value  = taint.value.value
        effect = taint.value.effect
      }
    }

    # Workload identity
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    metadata = {
      disable-legacy-endpoints = "true"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

output "cluster_name" {
  description = "GKE cluster name"
  value       = google_container_cluster.main.name
}

output "cluster_endpoint" {
  description = "GKE cluster endpoint"
  value       = google_container_cluster.main.endpoint
}

output "cluster_ca_certificate" {
  description = "GKE cluster CA certificate"
  value       = google_container_cluster.main.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "workload_identity_pool" {
  description = "Workload identity pool for service accounts"
  value       = "${var.project_id}.svc.id.goog"
}
