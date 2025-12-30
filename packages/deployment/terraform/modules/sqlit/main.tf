# SQLit Module - Decentralized Database Cluster
# Deploys SQLit nodes on EC2 with optional ARM64 support

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.0"
    }
  }
}

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for SQLit nodes"
  type        = list(string)
}

variable "node_count" {
  description = "Number of SQLit nodes"
  type        = number
  default     = 1
}

variable "instance_type" {
  description = "EC2 instance type (x86)"
  type        = string
  default     = "t3.medium"
}

variable "arm_instance_type" {
  description = "EC2 instance type (ARM64)"
  type        = string
  default     = "t4g.medium"
}

variable "use_arm64" {
  description = "Use ARM64 instances"
  type        = bool
  default     = false
}

variable "storage_size_gb" {
  description = "EBS storage size in GB"
  type        = number
  default     = 100
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
  default     = ""
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access SQLit"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "ecr_registry" {
  description = "ECR registry URL"
  type        = string
  default     = ""
}

variable "sqlit_image_tag" {
  description = "SQLit Docker image tag"
  type        = string
  default     = "latest"
}

locals {
  name_prefix   = "sqlit-${var.environment}"
  instance_type = var.use_arm64 ? var.arm_instance_type : var.instance_type
  
  # AMI selection based on architecture
  ami_filter = var.use_arm64 ? "amzn2-ami-hvm-*-arm64-gp2" : "amzn2-ami-hvm-*-x86_64-gp2"
}

# Security Group for SQLit
resource "aws_security_group" "sqlit" {
  name_prefix = "${local.name_prefix}-sg"
  description = "Security group for SQLit nodes"
  vpc_id      = var.vpc_id

  # SQLit port (internal)
  ingress {
    from_port   = 4001
    to_port     = 4001
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SQLit SQLit port"
  }

  # HTTP API
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SQLit HTTP API"
  }

  # Gossip protocol
  ingress {
    from_port   = 4002
    to_port     = 4002
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SQLit gossip"
  }

  # Raft consensus
  ingress {
    from_port   = 4003
    to_port     = 4003
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SQLit Raft"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = {
    Name        = "${local.name_prefix}-sg"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Get latest Amazon Linux 2 AMI
data "aws_ami" "amazon_linux_2" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = [local.ami_filter]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# IAM Role for SQLit instances
resource "aws_iam_role" "sqlit" {
  name_prefix = "${local.name_prefix}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Name        = "${local.name_prefix}-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "sqlit_ssm" {
  role       = aws_iam_role.sqlit.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "sqlit_ecr" {
  role       = aws_iam_role.sqlit.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "sqlit" {
  name_prefix = "${local.name_prefix}-profile"
  role        = aws_iam_role.sqlit.name
}

# SQLit EC2 Instances
resource "aws_instance" "sqlit" {
  count = var.node_count

  ami                    = data.aws_ami.amazon_linux_2.id
  instance_type          = local.instance_type
  subnet_id              = var.subnet_ids[count.index % length(var.subnet_ids)]
  vpc_security_group_ids = [aws_security_group.sqlit.id]
  iam_instance_profile   = aws_iam_instance_profile.sqlit.name
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.storage_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e
    
    # Install Docker
    yum update -y
    amazon-linux-extras install docker -y
    systemctl start docker
    systemctl enable docker
    
    # Login to ECR if provided
    if [ -n "${var.ecr_registry}" ]; then
      aws ecr get-login-password --region $(curl -s http://169.254.169.254/latest/meta-data/placement/region) | docker login --username AWS --password-stdin ${var.ecr_registry}
    fi
    
    # Create data directory
    mkdir -p /data/sqlit
    
    # Run SQLit container
    docker run -d \
      --name sqlit \
      --restart unless-stopped \
      -p 4001:4001 \
      -p 4002:4002 \
      -p 4003:4003 \
      -p 8080:8080 \
      -v /data/sqlit:/data \
      -e NODE_ID=${count.index} \
      -e ENVIRONMENT=${var.environment} \
      ${var.ecr_registry != "" ? "${var.ecr_registry}/sqlit:${var.sqlit_image_tag}" : "sqlit:${var.sqlit_image_tag}"}
  EOF
  )

  tags = {
    Name        = "${local.name_prefix}-${count.index}"
    Environment = var.environment
    Service     = "sqlit"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# Outputs
output "instance_ids" {
  description = "SQLit instance IDs"
  value       = aws_instance.sqlit[*].id
}

output "private_ips" {
  description = "SQLit private IPs"
  value       = aws_instance.sqlit[*].private_ip
}

output "security_group_id" {
  description = "SQLit security group ID"
  value       = aws_security_group.sqlit.id
}

output "endpoint" {
  description = "SQLit primary endpoint"
  value       = length(aws_instance.sqlit) > 0 ? "http://${aws_instance.sqlit[0].private_ip}:8080" : ""
}

output "http_endpoint" {
  description = "SQLit HTTP endpoint"
  value       = length(aws_instance.sqlit) > 0 ? "http://${aws_instance.sqlit[0].private_ip}:8080" : ""
}

output "node_ips" {
  description = "SQLit node IP addresses"
  value       = aws_instance.sqlit[*].private_ip
}

output "architecture" {
  description = "SQLit instance architecture"
  value       = var.use_arm64 ? "arm64" : "x86_64"
}

output "sqlit_image" {
  description = "SQLit Docker image"
  value       = var.ecr_registry != "" ? "${var.ecr_registry}/sqlit:${var.sqlit_image_tag}" : "sqlit:${var.sqlit_image_tag}"
}
