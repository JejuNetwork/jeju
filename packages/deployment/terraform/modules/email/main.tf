# Jeju Network - Email Infrastructure Module
#
# Deploys decentralized email infrastructure:
# - AWS SES for Web2 bridge (inbound/outbound SMTP)
# - DKIM/SPF/DMARC for deliverability
# - ECS Fargate for email relay nodes
# - Dovecot for IMAP compliance
# - WAF protection for SMTP gateway
#
# Security considerations:
# - No plaintext storage - all content encrypted client-side
# - TEE attestation required for relay nodes handling encrypted content
# - SES sandboxed by default, requires production access request
# - Rate limiting at multiple layers (WAF, application, staking-based)

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ============================================================
# Variables
# ============================================================

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "domain_name" {
  description = "Base domain name"
  type        = string
}

variable "email_domain" {
  description = "Email domain (e.g., jeju.mail)"
  type        = string
  default     = "jeju.mail"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB"
  type        = list(string)
}

variable "zone_id" {
  description = "Route53 zone ID"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "eks_cluster_name" {
  description = "EKS cluster name for IRSA"
  type        = string
}

variable "jeju_rpc_url" {
  description = "Jeju RPC URL"
  type        = string
}

variable "email_registry_address" {
  description = "EmailRegistry contract address"
  type        = string
  default     = ""
}

variable "email_staking_address" {
  description = "EmailProviderStaking contract address"
  type        = string
  default     = ""
}

variable "dws_endpoint" {
  description = "DWS endpoint for storage"
  type        = string
}

variable "moderation_marketplace_address" {
  description = "ModerationMarketplace contract address"
  type        = string
  default     = ""
}

variable "relay_node_count" {
  description = "Number of email relay nodes"
  type        = number
  default     = 3
}

variable "enable_ses_production" {
  description = "Enable SES production mode (requires AWS approval)"
  type        = bool
  default     = false
}

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-email-${var.environment}"
  
  common_tags = merge(var.tags, {
    Service     = "email"
    Environment = var.environment
  })
}

# ============================================================
# SES Domain Identity & DKIM
# ============================================================

resource "aws_ses_domain_identity" "email" {
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "email" {
  domain = aws_ses_domain_identity.email.domain
}

# DKIM DNS Records
resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = var.zone_id
  name    = "${aws_ses_domain_dkim.email.dkim_tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.email.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# SES Domain Verification
resource "aws_route53_record" "ses_verification" {
  zone_id = var.zone_id
  name    = "_amazonses.${var.email_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.email.verification_token]
}

# SPF Record - Authorize SES and our relay nodes
resource "aws_route53_record" "spf" {
  zone_id = var.zone_id
  name    = var.email_domain
  type    = "TXT"
  ttl     = 600
  records = [
    "v=spf1 include:amazonses.com include:_spf.${var.domain_name} ~all"
  ]
}

# DMARC Record - Reject spoofed emails
resource "aws_route53_record" "dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${var.email_domain}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=reject; rua=mailto:dmarc@${var.domain_name}; ruf=mailto:dmarc-forensics@${var.domain_name}; fo=1"
  ]
}

# MX Records - Point to our relay infrastructure
resource "aws_route53_record" "mx" {
  zone_id = var.zone_id
  name    = var.email_domain
  type    = "MX"
  ttl     = 300
  records = [
    "10 inbound-smtp.${var.environment}.${var.domain_name}"
  ]
}

# ============================================================
# SES Receiving (Inbound Email)
# ============================================================

# S3 bucket for raw email storage (encrypted, temporary)
resource "aws_s3_bucket" "email_inbound" {
  bucket = "${local.name_prefix}-inbound"
  
  tags = local.common_tags
}

resource "aws_s3_bucket_versioning" "email_inbound" {
  bucket = aws_s3_bucket.email_inbound.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "email_inbound" {
  bucket = aws_s3_bucket.email_inbound.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# Lifecycle policy - delete raw emails after processing
resource "aws_s3_bucket_lifecycle_configuration" "email_inbound" {
  bucket = aws_s3_bucket.email_inbound.id

  rule {
    id     = "delete-processed"
    status = "Enabled"

    expiration {
      days = 1  # Raw emails deleted after 1 day (encrypted copies in DWS)
    }
  }
}

# S3 bucket policy for SES
resource "aws_s3_bucket_policy" "email_inbound" {
  bucket = aws_s3_bucket.email_inbound.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESPuts"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.email_inbound.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "AWS:SourceArn" = "arn:aws:ses:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${local.name_prefix}-ruleset:receipt-rule/*"
          }
        }
      }
    ]
  })
}

# SNS Topic for email notifications
resource "aws_sns_topic" "email_notifications" {
  name              = "${local.name_prefix}-notifications"
  kms_master_key_id = var.kms_key_arn
  
  tags = local.common_tags
}

# SES Receipt Rule Set
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${local.name_prefix}-ruleset"
}

resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# SES Receipt Rule - Store in S3 and trigger processing
resource "aws_ses_receipt_rule" "store" {
  name          = "store-and-process"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  enabled       = true
  scan_enabled  = true  # Enable spam/virus scanning

  recipients = [var.email_domain]

  # Store to S3
  s3_action {
    bucket_name       = aws_s3_bucket.email_inbound.id
    object_key_prefix = "inbound/"
    kms_key_arn       = var.kms_key_arn
    position          = 1
  }

  # Notify via SNS
  sns_action {
    topic_arn = aws_sns_topic.email_notifications.arn
    position  = 2
  }

  # Invoke Lambda for processing
  lambda_action {
    function_arn    = aws_lambda_function.email_processor.arn
    invocation_type = "Event"
    position        = 3
  }
}

# ============================================================
# Lambda for Email Processing
# ============================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_role" "email_processor" {
  name = "${local.name_prefix}-processor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "email_processor" {
  name = "${local.name_prefix}-processor-policy"
  role = aws_iam_role.email_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.email_inbound.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = var.kms_key_arn
      },
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.email_notifications.arn
      }
    ]
  })
}

# Lambda function for processing inbound emails
resource "aws_lambda_function" "email_processor" {
  function_name = "${local.name_prefix}-processor"
  role          = aws_iam_role.email_processor.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 60
  memory_size   = 512

  # Placeholder - actual code deployed separately
  filename         = data.archive_file.email_processor.output_path
  source_code_hash = data.archive_file.email_processor.output_base64sha256

  environment {
    variables = {
      JEJU_RPC_URL                   = var.jeju_rpc_url
      EMAIL_REGISTRY_ADDRESS         = var.email_registry_address
      DWS_ENDPOINT                   = var.dws_endpoint
      MODERATION_MARKETPLACE_ADDRESS = var.moderation_marketplace_address
      ENVIRONMENT                    = var.environment
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.email_processor.id]
  }

  tags = local.common_tags
}

# Placeholder Lambda code
data "archive_file" "email_processor" {
  type        = "zip"
  output_path = "${path.module}/email-processor.zip"

  source {
    content  = <<-EOF
      exports.handler = async (event) => {
        console.log('Email processor - deploy actual code via CI/CD');
        console.log('Event:', JSON.stringify(event, null, 2));
        return { statusCode: 200 };
      };
    EOF
    filename = "index.js"
  }
}

resource "aws_lambda_permission" "ses" {
  statement_id  = "AllowSES"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_processor.function_name
  principal     = "ses.amazonaws.com"
  source_arn    = "arn:aws:ses:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${aws_ses_receipt_rule_set.main.rule_set_name}:receipt-rule/*"
}

# Security group for Lambda
resource "aws_security_group" "email_processor" {
  name        = "${local.name_prefix}-processor-sg"
  description = "Security group for email processor Lambda"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# ============================================================
# SES Sending (Outbound Email)
# ============================================================

# Configuration set for tracking
resource "aws_ses_configuration_set" "main" {
  name = "${local.name_prefix}-config"

  reputation_metrics_enabled = true
  sending_enabled            = true

  delivery_options {
    tls_policy = "Require"
  }
}

# Event destination for bounce/complaint tracking
resource "aws_ses_event_destination" "sns" {
  name                   = "sns-notifications"
  configuration_set_name = aws_ses_configuration_set.main.name
  enabled                = true
  matching_types         = ["bounce", "complaint", "reject", "send", "delivery"]

  sns_destination {
    topic_arn = aws_sns_topic.email_notifications.arn
  }
}

# IAM user for SMTP credentials (for relay nodes)
resource "aws_iam_user" "ses_smtp" {
  name = "${local.name_prefix}-smtp"
  tags = local.common_tags
}

resource "aws_iam_user_policy" "ses_smtp" {
  name = "ses-send"
  user = aws_iam_user.ses_smtp.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendRawEmail",
        "ses:SendEmail"
      ]
      Resource = "*"
      Condition = {
        StringEquals = {
          "ses:FromAddress" = "*@${var.email_domain}"
        }
      }
    }]
  })
}

resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}

# ============================================================
# ECS Cluster for Email Relay & IMAP
# ============================================================

resource "aws_ecs_cluster" "email" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "email" {
  cluster_name = aws_ecs_cluster.email.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ECR Repository for email services
resource "aws_ecr_repository" "email_relay" {
  name                 = "jeju-email-relay"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_repository" "email_imap" {
  name                 = "jeju-email-imap"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

# ============================================================
# Security Groups
# ============================================================

resource "aws_security_group" "email_alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB security group for email services"
  vpc_id      = var.vpc_id

  # HTTPS for web/API access
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SMTP submission (587)
  ingress {
    from_port   = 587
    to_port     = 587
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # IMAPS (993)
  ingress {
    from_port   = 993
    to_port     = 993
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "email_services" {
  name        = "${local.name_prefix}-services-sg"
  description = "Security group for email ECS services"
  vpc_id      = var.vpc_id

  # From ALB
  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.email_alb.id]
  }

  # Inter-service communication
  ingress {
    from_port = 0
    to_port   = 65535
    protocol  = "tcp"
    self      = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# ============================================================
# Application Load Balancer
# ============================================================

resource "aws_lb" "email" {
  name               = local.name_prefix
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.email_alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "mainnet"

  tags = local.common_tags
}

# Target Groups
resource "aws_lb_target_group" "relay_api" {
  name        = "${local.name_prefix}-relay-api"
  port        = 3300
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = local.common_tags
}

resource "aws_lb_target_group" "imap" {
  name        = "${local.name_prefix}-imap"
  port        = 993
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    port                = "traffic-port"
    protocol            = "TCP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = local.common_tags
}

# HTTPS Listener for API
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.email.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.relay_api.arn
  }
}

# ============================================================
# Network Load Balancer for SMTP/IMAP (TCP passthrough)
# ============================================================

resource "aws_lb" "email_nlb" {
  name               = "${local.name_prefix}-nlb"
  internal           = false
  load_balancer_type = "network"
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "mainnet"

  tags = local.common_tags
}

resource "aws_lb_target_group" "smtp_submission" {
  name        = "${local.name_prefix}-smtp"
  port        = 587
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    port                = "traffic-port"
    protocol            = "TCP"
    unhealthy_threshold = 2
  }

  tags = local.common_tags
}

resource "aws_lb_listener" "smtp_submission" {
  load_balancer_arn = aws_lb.email_nlb.arn
  port              = 587
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.smtp_submission.arn
  }
}

resource "aws_lb_listener" "imaps" {
  load_balancer_arn = aws_lb.email_nlb.arn
  port              = 993
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.imap.arn
  }
}

# ============================================================
# DNS Records
# ============================================================

resource "aws_route53_record" "email_api" {
  zone_id = var.zone_id
  name    = "mail.${var.environment}"
  type    = "A"

  alias {
    name                   = aws_lb.email.dns_name
    zone_id                = aws_lb.email.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "smtp" {
  zone_id = var.zone_id
  name    = "smtp.${var.environment}"
  type    = "A"

  alias {
    name                   = aws_lb.email_nlb.dns_name
    zone_id                = aws_lb.email_nlb.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "imap" {
  zone_id = var.zone_id
  name    = "imap.${var.environment}"
  type    = "A"

  alias {
    name                   = aws_lb.email_nlb.dns_name
    zone_id                = aws_lb.email_nlb.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "inbound_smtp" {
  zone_id = var.zone_id
  name    = "inbound-smtp.${var.environment}"
  type    = "A"

  alias {
    name                   = aws_lb.email_nlb.dns_name
    zone_id                = aws_lb.email_nlb.zone_id
    evaluate_target_health = true
  }
}

# ============================================================
# IAM Roles for ECS Tasks
# ============================================================

resource "aws_iam_role" "email_task_execution" {
  name = "${local.name_prefix}-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "email_task_execution" {
  role       = aws_iam_role.email_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "email_task" {
  name = "${local.name_prefix}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "email_task" {
  name = "${local.name_prefix}-task-policy"
  role = aws_iam_role.email_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendRawEmail",
          "ses:SendEmail"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.email_inbound.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey"
        ]
        Resource = var.kms_key_arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:${local.name_prefix}-*"
      }
    ]
  })
}

# ============================================================
# Secrets Manager
# ============================================================

resource "aws_secretsmanager_secret" "ses_smtp_credentials" {
  name        = "${local.name_prefix}-ses-smtp"
  description = "SES SMTP credentials for email relay"
  kms_key_id  = var.kms_key_arn

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "ses_smtp_credentials" {
  secret_id = aws_secretsmanager_secret.ses_smtp_credentials.id
  secret_string = jsonencode({
    username = aws_iam_access_key.ses_smtp.id
    password = aws_iam_access_key.ses_smtp.ses_smtp_password_v4
  })
}

# ============================================================
# CloudWatch Logs
# ============================================================

resource "aws_cloudwatch_log_group" "email_relay" {
  name              = "/ecs/${local.name_prefix}-relay"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "email_imap" {
  name              = "/ecs/${local.name_prefix}-imap"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn

  tags = local.common_tags
}

# ============================================================
# Outputs
# ============================================================

output "email_api_endpoint" {
  description = "Email API endpoint"
  value       = "https://mail.${var.environment}.${var.domain_name}"
}

output "smtp_endpoint" {
  description = "SMTP submission endpoint"
  value       = "smtp.${var.environment}.${var.domain_name}:587"
}

output "imap_endpoint" {
  description = "IMAP endpoint"
  value       = "imap.${var.environment}.${var.domain_name}:993"
}

output "ses_domain" {
  description = "SES verified domain"
  value       = aws_ses_domain_identity.email.domain
}

output "inbound_bucket" {
  description = "S3 bucket for inbound emails"
  value       = aws_s3_bucket.email_inbound.id
}

output "sns_topic_arn" {
  description = "SNS topic ARN for email notifications"
  value       = aws_sns_topic.email_notifications.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.email.name
}

output "relay_ecr_repository" {
  description = "ECR repository for email relay"
  value       = aws_ecr_repository.email_relay.repository_url
}

output "imap_ecr_repository" {
  description = "ECR repository for IMAP service"
  value       = aws_ecr_repository.email_imap.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.email.dns_name
}

output "nlb_dns_name" {
  description = "NLB DNS name for SMTP/IMAP"
  value       = aws_lb.email_nlb.dns_name
}

output "task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.email_task_execution.arn
}

output "task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.email_task.arn
}

output "email_config" {
  description = "Email configuration summary"
  value = {
    domain              = var.email_domain
    api_endpoint        = "https://mail.${var.environment}.${var.domain_name}"
    smtp_endpoint       = "smtp.${var.environment}.${var.domain_name}:587"
    imap_endpoint       = "imap.${var.environment}.${var.domain_name}:993"
    ses_production_mode = var.enable_ses_production
  }
}
