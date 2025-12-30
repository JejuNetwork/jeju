# Jeju Messaging Infrastructure Module
# Deploys relay nodes, integrates with SQLit and KMS

variable "environment" {
  description = "Environment name (testnet, mainnet)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for services"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for load balancers"
  type        = list(string)
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "sqlit_endpoint" {
  description = "SQLit endpoint URL"
  type        = string
}

variable "jeju_rpc_url" {
  description = "Jeju L2 RPC URL"
  type        = string
}

variable "key_registry_address" {
  description = "KeyRegistry contract address on Jeju L2"
  type        = string
}

variable "node_registry_address" {
  description = "MessageNodeRegistry contract address on Jeju L2"
  type        = string
}

variable "farcaster_hub_url" {
  description = "Farcaster Hub gRPC URL"
  type        = string
  default     = "nemes.farcaster.xyz:2283"
}

variable "relay_node_count" {
  description = "Number of relay nodes to deploy"
  type        = number
  default     = 3
}

variable "kms_key_arn" {
  description = "KMS key ARN for encrypting secrets"
  type        = string
}

variable "domain_name" {
  description = "Domain name for services"
  type        = string
}

variable "zone_id" {
  description = "Route53 zone ID"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN"
  type        = string
}

variable "tags" {
  description = "Tags to apply"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-messaging-${var.environment}"
}

# ============================================================
# Security Groups
# ============================================================

resource "aws_security_group" "relay" {
  name        = "${local.name_prefix}-relay"
  description = "Security group for messaging relay nodes"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 3200
    to_port     = 3200
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "HTTP API from internal"
  }

  ingress {
    from_port   = 3201
    to_port     = 3201
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "WebSocket from internal"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-relay"
  })
}

resource "aws_security_group" "kms_api" {
  name        = "${local.name_prefix}-kms-api"
  description = "Security group for Jeju KMS API"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 3300
    to_port     = 3300
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "KMS API from internal"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-kms-api"
  })
}

# ============================================================
# Secrets Manager for Operator Keys
# ============================================================

resource "aws_secretsmanager_secret" "relay_operator_keys" {
  name        = "${local.name_prefix}/relay-operator-keys"
  description = "Private keys for messaging relay node operators"
  kms_key_id  = var.kms_key_arn

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-relay-operator-keys"
  })
}

resource "aws_secretsmanager_secret" "kms_master_key" {
  name        = "${local.name_prefix}/kms-master-key"
  description = "Master key for Jeju KMS service"
  kms_key_id  = var.kms_key_arn

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-kms-master-key"
  })
}

resource "aws_secretsmanager_secret" "sqlit_credentials" {
  name        = "${local.name_prefix}/sqlit-credentials"
  description = "SQLit authentication credentials"
  kms_key_id  = var.kms_key_arn

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-sqlit-credentials"
  })
}

# ============================================================
# SSM Parameters for Service Discovery
# ============================================================

resource "aws_ssm_parameter" "relay_endpoint" {
  name        = "/jeju/${var.environment}/messaging/relay-endpoint"
  description = "Messaging relay endpoint URL"
  type        = "String"
  value       = "https://relay.${var.environment}.${var.domain_name}"

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-relay-endpoint"
  })
}

resource "aws_ssm_parameter" "sqlit_endpoint" {
  name        = "/jeju/${var.environment}/messaging/sqlit-endpoint"
  description = "SQLit endpoint for messaging"
  type        = "String"
  value       = var.sqlit_endpoint

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-sqlit-endpoint"
  })
}

resource "aws_ssm_parameter" "kms_endpoint" {
  name        = "/jeju/${var.environment}/messaging/kms-endpoint"
  description = "Jeju KMS API endpoint"
  type        = "String"
  value       = "https://kms.${var.environment}.${var.domain_name}"

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-kms-endpoint"
  })
}

resource "aws_ssm_parameter" "key_registry_address" {
  count       = var.key_registry_address != "" ? 1 : 0
  name        = "/jeju/${var.environment}/messaging/key-registry-address"
  description = "KeyRegistry contract address"
  type        = "String"
  value       = var.key_registry_address

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-key-registry"
  })
}

resource "aws_ssm_parameter" "node_registry_address" {
  count       = var.node_registry_address != "" ? 1 : 0
  name        = "/jeju/${var.environment}/messaging/node-registry-address"
  description = "MessageNodeRegistry contract address"
  type        = "String"
  value       = var.node_registry_address

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-node-registry"
  })
}

resource "aws_ssm_parameter" "farcaster_hub_url" {
  name        = "/jeju/${var.environment}/messaging/farcaster-hub-url"
  description = "Farcaster Hub URL"
  type        = "String"
  value       = var.farcaster_hub_url

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-farcaster-hub"
  })
}

# ============================================================
# IAM Role for Messaging Services (EKS IRSA)
# ============================================================

data "aws_eks_cluster" "cluster" {
  name = var.eks_cluster_name
}

data "aws_iam_policy_document" "messaging_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringLike"
      variable = "${replace(data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer, "https://", "")}:sub"
      values   = ["system:serviceaccount:jeju-messaging:*"]
    }

    principals {
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${replace(data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer, "https://", "")}"]
      type        = "Federated"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "messaging" {
  name               = "${local.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.messaging_assume_role.json

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-role"
  })
}

resource "aws_iam_role_policy" "messaging" {
  name = "${local.name_prefix}-policy"
  role = aws_iam_role.messaging.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.relay_operator_keys.arn,
          aws_secretsmanager_secret.kms_master_key.arn,
          aws_secretsmanager_secret.sqlit_credentials.arn
        ]
      },
      {
        Sid    = "SSMParameterAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:*:*:parameter/jeju/${var.environment}/*"
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

# ============================================================
# CloudWatch Log Groups
# ============================================================

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/jeju/${var.environment}/messaging/relay"
  retention_in_days = var.environment == "mainnet" ? 90 : 30

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-relay-logs"
  })
}

resource "aws_cloudwatch_log_group" "kms" {
  name              = "/jeju/${var.environment}/messaging/kms"
  retention_in_days = var.environment == "mainnet" ? 90 : 30

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-kms-logs"
  })
}

# ============================================================
# Route53 Records
# ============================================================

resource "aws_route53_record" "relay" {
  zone_id = var.zone_id
  name    = "relay.${var.environment}"
  type    = "CNAME"
  ttl     = 300
  records = ["${var.eks_cluster_name}-relay.${var.domain_name}"]
}

resource "aws_route53_record" "kms" {
  zone_id = var.zone_id
  name    = "kms.${var.environment}"
  type    = "CNAME"
  ttl     = 300
  records = ["${var.eks_cluster_name}-kms.${var.domain_name}"]
}

# ============================================================
# Outputs
# ============================================================

output "relay_security_group_id" {
  description = "Security group ID for relay nodes"
  value       = aws_security_group.relay.id
}

output "kms_security_group_id" {
  description = "Security group ID for KMS API"
  value       = aws_security_group.kms_api.id
}

output "messaging_role_arn" {
  description = "IAM role ARN for messaging services"
  value       = aws_iam_role.messaging.arn
}

output "relay_operator_keys_secret_arn" {
  description = "Secrets Manager ARN for relay operator keys"
  value       = aws_secretsmanager_secret.relay_operator_keys.arn
}

output "kms_master_key_secret_arn" {
  description = "Secrets Manager ARN for KMS master key"
  value       = aws_secretsmanager_secret.kms_master_key.arn
}

output "sqlit_credentials_secret_arn" {
  description = "Secrets Manager ARN for SQLit credentials"
  value       = aws_secretsmanager_secret.sqlit_credentials.arn
}

output "relay_endpoint" {
  description = "Relay endpoint URL"
  value       = "https://relay.${var.environment}.${var.domain_name}"
}

output "kms_endpoint" {
  description = "KMS API endpoint URL"
  value       = "https://kms.${var.environment}.${var.domain_name}"
}

output "service_discovery" {
  description = "Service discovery configuration"
  value = {
    relay_endpoint    = "https://relay.${var.environment}.${var.domain_name}"
    kms_endpoint      = "https://kms.${var.environment}.${var.domain_name}"
    sqlit       = var.sqlit_endpoint
    farcaster_hub     = var.farcaster_hub_url
    key_registry      = var.key_registry_address
    node_registry     = var.node_registry_address
  }
}

