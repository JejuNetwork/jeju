# OAuth3 TEE Auth Agent Infrastructure Module
#
# Provisions infrastructure for OAuth3 authentication agents:
# - AWS: EC2 instances with Nitro Enclaves or standard instances
# - GCP: Confidential VMs or standard VMs
# - Secrets management via KMS/Secret Manager
# - Load balancing and networking

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "cloud_provider" {
  description = "Cloud provider (aws or gcp)"
  type        = string
  default     = "aws"
}

variable "region" {
  description = "Cloud region"
  type        = string
  default     = "us-east-1"
}

variable "instance_count" {
  description = "Number of OAuth3 agent instances (should be 3 for MPC)"
  type        = number
  default     = 3
}

variable "instance_type" {
  description = "Instance type (AWS: c6i.xlarge for Nitro, GCP: n2d-standard-4 for Confidential)"
  type        = string
  default     = "c6i.xlarge"
}

variable "enable_tee" {
  description = "Enable TEE (Nitro Enclaves on AWS, Confidential VMs on GCP)"
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "VPC ID (AWS) or Network name (GCP)"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for the instances"
  type        = list(string)
}

variable "domain" {
  description = "Domain for OAuth3 service"
  type        = string
  default     = "oauth3.jejunetwork.org"
}

variable "chain_id" {
  description = "Jeju chain ID"
  type        = string
  default     = "420690"
}

variable "rpc_url" {
  description = "Jeju RPC URL"
  type        = string
}

variable "dws_url" {
  description = "DWS storage URL"
  type        = string
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# Locals
# -----------------------------------------------------------------------------

locals {
  name_prefix = "oauth3-${var.environment}"
  
  default_tags = merge(var.tags, {
    Service     = "oauth3"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# -----------------------------------------------------------------------------
# AWS Resources
# -----------------------------------------------------------------------------

# Security Group for OAuth3 agents
resource "aws_security_group" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-sg-"
  vpc_id      = var.vpc_id
  description = "Security group for OAuth3 TEE agents"

  # HTTP for OAuth callbacks and API
  ingress {
    from_port   = 4200
    to_port     = 4200
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "OAuth3 HTTP API"
  }

  # MPC coordination port (internal only)
  ingress {
    from_port   = 4100
    to_port     = 4100
    protocol    = "tcp"
    self        = true
    description = "MPC coordination"
  }

  # Health checks
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Load balancer health checks"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, {
    Name = "${local.name_prefix}-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# IAM Role for OAuth3 instances
resource "aws_iam_role" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-role-"

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

  tags = local.default_tags
}

# IAM policy for Secrets Manager access
resource "aws_iam_role_policy" "oauth3_secrets" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-secrets-"
  role        = aws_iam_role.oauth3[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.region}:*:secret:${local.name_prefix}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

# Instance Profile
resource "aws_iam_instance_profile" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-profile-"
  role        = aws_iam_role.oauth3[0].name

  tags = local.default_tags
}

# Launch Template for OAuth3 instances
resource "aws_launch_template" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-lt-"

  image_id      = data.aws_ami.amazon_linux[0].id
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.oauth3[0].arn
  }

  network_interfaces {
    security_groups             = [aws_security_group.oauth3[0].id]
    associate_public_ip_address = true
  }

  # Enable Nitro Enclaves if TEE is enabled
  enclave_options {
    enabled = var.enable_tee
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(local.default_tags, {
      Name = "${local.name_prefix}-instance"
    })
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    environment = var.environment
    chain_id    = var.chain_id
    rpc_url     = var.rpc_url
    dws_url     = var.dws_url
    tee_mode    = var.enable_tee ? "nitro" : "simulated"
  }))

  tags = local.default_tags
}

# Auto Scaling Group
resource "aws_autoscaling_group" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "${local.name_prefix}-asg-"

  desired_capacity = var.instance_count
  min_size         = var.instance_count
  max_size         = var.instance_count

  vpc_zone_identifier = var.subnet_ids

  launch_template {
    id      = aws_launch_template.oauth3[0].id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.oauth3[0].arn]

  health_check_type         = "ELB"
  health_check_grace_period = 300

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-instance"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = local.default_tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

# Application Load Balancer
resource "aws_lb" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix        = "oauth3"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.oauth3[0].id]
  subnets            = var.subnet_ids

  tags = merge(local.default_tags, {
    Name = "${local.name_prefix}-alb"
  })
}

# Target Group
resource "aws_lb_target_group" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  name_prefix = "oauth3"
  port        = 4200
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
  }

  # Sticky sessions for OAuth callbacks
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 3600
    enabled         = true
  }

  tags = local.default_tags
}

# Load Balancer Listener
resource "aws_lb_listener" "oauth3" {
  count = var.cloud_provider == "aws" ? 1 : 0

  load_balancer_arn = aws_lb.oauth3[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.oauth3[0].arn
  }
}

# Data source for Amazon Linux AMI
data "aws_ami" "amazon_linux" {
  count = var.cloud_provider == "aws" ? 1 : 0

  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# -----------------------------------------------------------------------------
# GCP Resources
# -----------------------------------------------------------------------------

# Firewall rules for OAuth3
resource "google_compute_firewall" "oauth3" {
  count = var.cloud_provider == "gcp" ? 1 : 0

  name    = "${local.name_prefix}-fw"
  network = var.vpc_id

  allow {
    protocol = "tcp"
    ports    = ["4200", "4100", "80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["oauth3"]
}

# Instance Template for OAuth3
resource "google_compute_instance_template" "oauth3" {
  count = var.cloud_provider == "gcp" ? 1 : 0

  name_prefix = "${local.name_prefix}-"
  
  machine_type = var.instance_type

  # Enable Confidential VM if TEE is enabled
  dynamic "confidential_instance_config" {
    for_each = var.enable_tee ? [1] : []
    content {
      enable_confidential_compute = true
    }
  }

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
    disk_size_gb = 50
  }

  network_interface {
    network    = var.vpc_id
    subnetwork = var.subnet_ids[0]
    access_config {}
  }

  service_account {
    scopes = ["cloud-platform"]
  }

  tags = ["oauth3"]

  labels = local.default_tags

  metadata_startup_script = templatefile("${path.module}/startup-script.sh", {
    environment = var.environment
    chain_id    = var.chain_id
    rpc_url     = var.rpc_url
    dws_url     = var.dws_url
    tee_mode    = var.enable_tee ? "gcp-confidential" : "simulated"
  })
}

# Managed Instance Group
resource "google_compute_instance_group_manager" "oauth3" {
  count = var.cloud_provider == "gcp" ? 1 : 0

  name               = "${local.name_prefix}-mig"
  base_instance_name = "${local.name_prefix}"
  zone               = "${var.region}-a"

  version {
    instance_template = google_compute_instance_template.oauth3[0].id
  }

  target_size = var.instance_count

  named_port {
    name = "http"
    port = 4200
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.oauth3[0].id
    initial_delay_sec = 300
  }
}

# Health Check
resource "google_compute_health_check" "oauth3" {
  count = var.cloud_provider == "gcp" ? 1 : 0

  name = "${local.name_prefix}-hc"

  http_health_check {
    port         = 4200
    request_path = "/health"
  }

  check_interval_sec  = 30
  timeout_sec         = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3
}

# -----------------------------------------------------------------------------
# Variables that need additional resources
# -----------------------------------------------------------------------------

variable "certificate_arn" {
  description = "ACM certificate ARN (AWS only)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "load_balancer_dns" {
  description = "Load balancer DNS name"
  value = var.cloud_provider == "aws" ? (
    length(aws_lb.oauth3) > 0 ? aws_lb.oauth3[0].dns_name : ""
  ) : ""
}

output "security_group_id" {
  description = "Security group ID (AWS)"
  value = var.cloud_provider == "aws" ? (
    length(aws_security_group.oauth3) > 0 ? aws_security_group.oauth3[0].id : ""
  ) : ""
}

output "instance_role_arn" {
  description = "IAM role ARN for OAuth3 instances (AWS)"
  value = var.cloud_provider == "aws" ? (
    length(aws_iam_role.oauth3) > 0 ? aws_iam_role.oauth3[0].arn : ""
  ) : ""
}
