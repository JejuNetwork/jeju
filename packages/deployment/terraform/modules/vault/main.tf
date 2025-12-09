# HashiCorp Vault for secrets management

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace for Vault"
  type        = string
  default     = "infra"
}

variable "replicas" {
  description = "Number of Vault replicas"
  type        = number
  default     = 3
}

variable "vault_kms_key_id" {
  description = "KMS key ID for Vault auto-unseal"
  type        = string
}

variable "storage_size" {
  description = "Storage size for Vault data"
  type        = string
  default     = "10Gi"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# IAM role for Vault service account
resource "aws_iam_role" "vault" {
  name = "${local.name_prefix}-vault-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = var.oidc_provider_arn
      }
      Condition = {
        StringEquals = {
          "${replace(var.oidc_provider_url, "https://", "")}:sub" = "system:serviceaccount:${var.namespace}:vault"
          "${replace(var.oidc_provider_url, "https://", "")}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-vault-role"
    Environment = var.environment
  })
}

variable "oidc_provider_arn" {
  description = "EKS OIDC provider ARN"
  type        = string
}

variable "oidc_provider_url" {
  description = "EKS OIDC provider URL"
  type        = string
}

# IAM policy for Vault to use KMS for auto-unseal
resource "aws_iam_role_policy" "vault_kms" {
  name = "${local.name_prefix}-vault-kms-policy"
  role = aws_iam_role.vault.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "VaultKMSUnseal"
      Effect = "Allow"
      Action = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKey"
      ]
      Resource = "arn:aws:kms:*:*:key/${var.vault_kms_key_id}"
    }]
  })
}

# S3 bucket for Vault snapshots (optional)
resource "aws_s3_bucket" "vault_snapshots" {
  bucket = "${local.name_prefix}-vault-snapshots"

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-vault-snapshots"
    Environment = var.environment
  })
}

resource "aws_s3_bucket_versioning" "vault_snapshots" {
  bucket = aws_s3_bucket.vault_snapshots.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "vault_snapshots" {
  bucket = aws_s3_bucket.vault_snapshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "vault_snapshots" {
  bucket = aws_s3_bucket.vault_snapshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM policy for Vault to access S3 snapshots
resource "aws_iam_role_policy" "vault_s3" {
  name = "${local.name_prefix}-vault-s3-policy"
  role = aws_iam_role.vault.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "VaultS3Snapshots"
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ]
      Resource = [
        aws_s3_bucket.vault_snapshots.arn,
        "${aws_s3_bucket.vault_snapshots.arn}/*"
      ]
    }]
  })
}

# Vault configuration values for Helm
locals {
  vault_values = {
    global = {
      enabled = true
    }
    server = {
      image = {
        repository = "hashicorp/vault"
        tag        = "1.15.4"
      }
      replicas = var.replicas
      ha = {
        enabled  = true
        replicas = var.replicas
        raft = {
          enabled   = true
          setNodeId = true
          config = yamlencode({
            ui = true
            listener = {
              tcp = {
                address         = "[::]:8200"
                cluster_address = "[::]:8201"
                tls_disable     = 1
              }
            }
            storage = {
              raft = {
                path = "/vault/data"
              }
            }
            seal = {
              awskms = {
                region     = data.aws_region.current.name
                kms_key_id = var.vault_kms_key_id
              }
            }
            service_registration = {
              kubernetes = {}
            }
          })
        }
      }
      serviceAccount = {
        create = true
        name   = "vault"
        annotations = {
          "eks.amazonaws.com/role-arn" = aws_iam_role.vault.arn
        }
      }
      dataStorage = {
        enabled      = true
        size         = var.storage_size
        storageClass = "gp3"
      }
      auditStorage = {
        enabled      = true
        size         = "5Gi"
        storageClass = "gp3"
      }
      resources = {
        requests = {
          memory = "512Mi"
          cpu    = "250m"
        }
        limits = {
          memory = "1Gi"
          cpu    = "1000m"
        }
      }
    }
    ui = {
      enabled      = true
      serviceType  = "ClusterIP"
      externalPort = 8200
    }
  }
}

data "aws_region" "current" {}

# Outputs
output "vault_role_arn" {
  description = "Vault IAM role ARN"
  value       = aws_iam_role.vault.arn
}

output "vault_values" {
  description = "Vault Helm values"
  value       = local.vault_values
  sensitive   = true
}

output "vault_snapshots_bucket" {
  description = "S3 bucket for Vault snapshots"
  value       = aws_s3_bucket.vault_snapshots.bucket
}

output "vault_snapshots_bucket_arn" {
  description = "S3 bucket ARN for Vault snapshots"
  value       = aws_s3_bucket.vault_snapshots.arn
}


