# =============================================================================
# AWS Nitro Enclave Infrastructure for EVMSOL Bridge
# =============================================================================
#
# This deploys:
# - EC2 instance with Nitro Enclave support
# - Security groups for vsock and API access
# - IAM roles for KMS integration
# - CloudWatch for monitoring
#
# Usage:
#   cd deploy/terraform/aws
#   terraform init
#   terraform plan -var-file=prod.tfvars
#   terraform apply -var-file=prod.tfvars
# =============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configure in backend.tfvars
    # bucket = "your-terraform-state-bucket"
    # key    = "evmsol-bridge/terraform.tfstate"
    # region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "evmsol-bridge"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# =============================================================================
# VARIABLES
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "instance_type" {
  description = "EC2 instance type (must support Nitro Enclaves)"
  type        = string
  default     = "c5.xlarge"
}

variable "enclave_memory_mib" {
  description = "Memory to allocate to enclave (MB)"
  type        = number
  default     = 512
}

variable "enclave_cpu_count" {
  description = "vCPUs to allocate to enclave"
  type        = number
  default     = 2
}

variable "vpc_id" {
  description = "VPC ID (if using existing VPC)"
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Subnet ID (if using existing subnet)"
  type        = string
  default     = ""
}

variable "ssh_key_name" {
  description = "SSH key pair name for EC2 access"
  type        = string
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the bridge API. SECURITY: Do not use 0.0.0.0/0 in production."
  type        = list(string)
  # SECURITY: No default - must be explicitly configured to prevent accidental open access
  # For production, specify your organization's IP ranges or VPN CIDR blocks
  
  validation {
    condition     = length(var.allowed_cidr_blocks) > 0
    error_message = "allowed_cidr_blocks must contain at least one CIDR block."
  }
  
  validation {
    condition     = !contains(var.allowed_cidr_blocks, "0.0.0.0/0") || var.environment == "dev"
    error_message = "0.0.0.0/0 is only allowed in dev environment. Use specific CIDR blocks for staging/prod."
  }
}

# =============================================================================
# DATA SOURCES
# =============================================================================

data "aws_ami" "amazon_linux_2" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "selected" {
  count = var.vpc_id != "" ? 1 : 0
  id    = var.vpc_id
}

data "aws_subnet" "selected" {
  count = var.subnet_id != "" ? 1 : 0
  id    = var.subnet_id
}

# =============================================================================
# VPC (if not using existing)
# =============================================================================

resource "aws_vpc" "main" {
  count = var.vpc_id == "" ? 1 : 0

  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "evmsol-bridge-vpc-${var.environment}"
  }
}

resource "aws_subnet" "public" {
  count = var.subnet_id == "" ? 1 : 0

  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"

  tags = {
    Name = "evmsol-bridge-subnet-${var.environment}"
  }
}

resource "aws_internet_gateway" "main" {
  count = var.vpc_id == "" ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "evmsol-bridge-igw-${var.environment}"
  }
}

resource "aws_route_table" "public" {
  count = var.vpc_id == "" ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = {
    Name = "evmsol-bridge-rt-${var.environment}"
  }
}

resource "aws_route_table_association" "public" {
  count = var.subnet_id == "" ? 1 : 0

  subnet_id      = aws_subnet.public[0].id
  route_table_id = aws_route_table.public[0].id
}

# =============================================================================
# SECURITY GROUPS
# =============================================================================

resource "aws_security_group" "enclave" {
  name        = "evmsol-bridge-enclave-${var.environment}"
  description = "Security group for EVMSOL Bridge Nitro Enclave"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : aws_vpc.main[0].id

  # SSH access - SECURITY: Only enabled in dev environment
  # For staging/prod, use AWS Systems Manager Session Manager instead
  dynamic "ingress" {
    for_each = var.environment == "dev" ? [1] : []
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.allowed_cidr_blocks
      description = "SSH access (dev only)"
    }
  }

  # Bridge API
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  # Health check
  ingress {
    from_port   = 8081
    to_port     = 8081
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "evmsol-bridge-sg-${var.environment}"
  }
}

# =============================================================================
# IAM ROLE
# =============================================================================

resource "aws_iam_role" "enclave" {
  name = "evmsol-bridge-enclave-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.enclave.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "kms" {
  name = "evmsol-bridge-kms-policy"
  role = aws_iam_role.enclave.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:RecipientAttestation:ImageSha384" = aws_launch_template.enclave.id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "cloudwatch" {
  name = "evmsol-bridge-cloudwatch-policy"
  role = aws_iam_role.enclave.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "enclave" {
  name = "evmsol-bridge-enclave-profile-${var.environment}"
  role = aws_iam_role.enclave.name
}

# =============================================================================
# LAUNCH TEMPLATE
# =============================================================================

resource "aws_launch_template" "enclave" {
  name_prefix   = "evmsol-bridge-${var.environment}-"
  image_id      = data.aws_ami.amazon_linux_2.id
  instance_type = var.instance_type

  key_name = var.ssh_key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.enclave.name
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.enclave.id]
    subnet_id                   = var.subnet_id != "" ? var.subnet_id : aws_subnet.public[0].id
  }

  # Enable Nitro Enclaves
  enclave_options {
    enabled = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # Install dependencies
    yum update -y
    amazon-linux-extras install docker -y
    yum install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel

    # Configure enclave allocator
    cat > /etc/nitro_enclaves/allocator.yaml <<EOL
    ---
    memory_mib: ${var.enclave_memory_mib}
    cpu_count: ${var.enclave_cpu_count}
    EOL

    # Start services
    systemctl enable docker
    systemctl start docker
    systemctl enable nitro-enclaves-allocator
    systemctl start nitro-enclaves-allocator

    # Add ec2-user to docker and ne groups
    usermod -aG docker ec2-user
    usermod -aG ne ec2-user

    # Install monitoring agent
    yum install -y amazon-cloudwatch-agent

    # Signal completion
    echo "Nitro Enclave setup complete" > /var/log/enclave-setup.log
  EOF
  )

  tags = {
    Name = "evmsol-bridge-template-${var.environment}"
  }
}

# =============================================================================
# EC2 INSTANCE
# =============================================================================

resource "aws_instance" "enclave" {
  launch_template {
    id      = aws_launch_template.enclave.id
    version = "$Latest"
  }

  tags = {
    Name = "evmsol-bridge-${var.environment}"
  }
}

# =============================================================================
# CLOUDWATCH
# =============================================================================

resource "aws_cloudwatch_log_group" "enclave" {
  name              = "/evmsol-bridge/${var.environment}"
  retention_in_days = 30
}

resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "evmsol-bridge-high-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "CPU utilization above 80%"

  dimensions = {
    InstanceId = aws_instance.enclave.id
  }
}

# =============================================================================
# OUTPUTS
# =============================================================================

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.enclave.id
}

output "public_ip" {
  description = "Public IP address"
  value       = aws_instance.enclave.public_ip
}

output "api_endpoint" {
  description = "Bridge API endpoint"
  value       = "http://${aws_instance.enclave.public_ip}:8080"
}

output "health_endpoint" {
  description = "Health check endpoint"
  value       = "http://${aws_instance.enclave.public_ip}:8081/health"
}

output "security_group_id" {
  description = "Security group ID"
  value       = aws_security_group.enclave.id
}
