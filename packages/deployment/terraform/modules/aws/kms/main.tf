# KMS keys for encryption

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# KMS key for general encryption
resource "aws_kms_key" "main" {
  description             = "Main KMS key for ${local.name_prefix}"
  deletion_window_in_days = var.environment == "mainnet" ? 30 : 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-main-key"
    Environment = var.environment
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name_prefix}-main"
  target_key_id = aws_kms_key.main.key_id
}

# KMS key for Vault seal
resource "aws_kms_key" "vault" {
  description             = "KMS key for Vault auto-unseal in ${local.name_prefix}"
  deletion_window_in_days = var.environment == "mainnet" ? 30 : 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-vault-seal"
    Environment = var.environment
    Purpose     = "vault-seal"
  })
}

resource "aws_kms_alias" "vault" {
  name          = "alias/${local.name_prefix}-vault-seal"
  target_key_id = aws_kms_key.vault.key_id
}

# KMS key for sequencer/batcher/proposer keys
resource "aws_kms_key" "chain_operations" {
  description             = "KMS key for chain operations in ${local.name_prefix}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-chain-ops"
    Environment = var.environment
    Purpose     = "chain-operations"
  })
}

resource "aws_kms_alias" "chain_operations" {
  name          = "alias/${local.name_prefix}-chain-ops"
  target_key_id = aws_kms_key.chain_operations.key_id
}

# KMS key for EBS encryption
resource "aws_kms_key" "ebs" {
  description             = "KMS key for EBS volume encryption in ${local.name_prefix}"
  deletion_window_in_days = var.environment == "mainnet" ? 30 : 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-ebs"
    Environment = var.environment
    Purpose     = "ebs-encryption"
  })
}

resource "aws_kms_alias" "ebs" {
  name          = "alias/${local.name_prefix}-ebs"
  target_key_id = aws_kms_key.ebs.key_id
}

# KMS key for S3 encryption
resource "aws_kms_key" "s3" {
  description             = "KMS key for S3 bucket encryption in ${local.name_prefix}"
  deletion_window_in_days = var.environment == "mainnet" ? 30 : 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-s3"
    Environment = var.environment
    Purpose     = "s3-encryption"
  })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${local.name_prefix}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

# IAM policy for EKS to use KMS keys
resource "aws_iam_policy" "kms_access" {
  name        = "${local.name_prefix}-kms-access"
  description = "Policy for accessing KMS keys"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowKMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey"
        ]
        Resource = [
          aws_kms_key.main.arn,
          aws_kms_key.vault.arn,
          aws_kms_key.chain_operations.arn,
          aws_kms_key.ebs.arn,
          aws_kms_key.s3.arn
        ]
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-kms-access"
    Environment = var.environment
  })
}

# Outputs
output "main_key_id" {
  description = "Main KMS key ID"
  value       = aws_kms_key.main.key_id
}

output "main_key_arn" {
  description = "Main KMS key ARN"
  value       = aws_kms_key.main.arn
}

output "vault_key_id" {
  description = "Vault seal KMS key ID"
  value       = aws_kms_key.vault.key_id
}

output "vault_key_arn" {
  description = "Vault seal KMS key ARN"
  value       = aws_kms_key.vault.arn
}

output "chain_ops_key_id" {
  description = "Chain operations KMS key ID"
  value       = aws_kms_key.chain_operations.key_id
}

output "chain_ops_key_arn" {
  description = "Chain operations KMS key ARN"
  value       = aws_kms_key.chain_operations.arn
}

output "ebs_key_id" {
  description = "EBS KMS key ID"
  value       = aws_kms_key.ebs.key_id
}

output "ebs_key_arn" {
  description = "EBS KMS key ARN"
  value       = aws_kms_key.ebs.arn
}

output "s3_key_id" {
  description = "S3 KMS key ID"
  value       = aws_kms_key.s3.key_id
}

output "s3_key_arn" {
  description = "S3 KMS key ARN"
  value       = aws_kms_key.s3.arn
}

output "kms_access_policy_arn" {
  description = "KMS access policy ARN"
  value       = aws_iam_policy.kms_access.arn
}


