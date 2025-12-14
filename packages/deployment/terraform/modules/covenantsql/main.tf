# CovenantSQL Module - Decentralized Database Cluster
# Minimal node configuration for production

variable "environment" {
  description = "Environment name (testnet, mainnet)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the cluster"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for node placement"
  type        = list(string)
}

variable "node_count" {
  description = "Number of CovenantSQL nodes (minimum 3 for consensus)"
  type        = number
  default     = 3
}

variable "instance_type" {
  description = "EC2 instance type for nodes"
  type        = string
  default     = "t3.medium"
}

variable "storage_size_gb" {
  description = "EBS volume size in GB per node"
  type        = number
  default     = 100
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access nodes"
  type        = list(string)
  default     = []
}

variable "private_key_ssm_param" {
  description = "SSM parameter name for node private key"
  type        = string
  default     = "/jeju/covenantsql/private-key"
}

# Security Group for CovenantSQL nodes
resource "aws_security_group" "covenantsql" {
  name        = "jeju-covenantsql-${var.environment}"
  description = "Security group for CovenantSQL nodes"
  vpc_id      = var.vpc_id

  # CovenantSQL client port
  ingress {
    from_port   = 4661
    to_port     = 4661
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "CovenantSQL client connections"
  }

  # CovenantSQL node-to-node communication
  ingress {
    from_port   = 4662
    to_port     = 4662
    protocol    = "tcp"
    self        = true
    description = "Node-to-node communication"
  }

  # CovenantSQL Kayak (consensus) port
  ingress {
    from_port   = 4663
    to_port     = 4663
    protocol    = "tcp"
    self        = true
    description = "Kayak consensus"
  }

  # CovenantSQL HTTP API
  ingress {
    from_port   = 8546
    to_port     = 8546
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "HTTP API"
  }

  # SSH access
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SSH access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name        = "jeju-covenantsql-${var.environment}"
    Environment = var.environment
    Component   = "covenantsql"
  }
}

# IAM Role for CovenantSQL nodes
resource "aws_iam_role" "covenantsql" {
  name = "jeju-covenantsql-${var.environment}"

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

  tags = {
    Name        = "jeju-covenantsql-${var.environment}"
    Environment = var.environment
  }
}

# IAM Policy for SSM and CloudWatch
resource "aws_iam_role_policy" "covenantsql" {
  name = "jeju-covenantsql-${var.environment}"
  role = aws_iam_role.covenantsql.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:*:*:parameter/jeju/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeTags"
        ]
        Resource = "*"
      }
    ]
  })
}

# Instance Profile
resource "aws_iam_instance_profile" "covenantsql" {
  name = "jeju-covenantsql-${var.environment}"
  role = aws_iam_role.covenantsql.name
}

# EBS Volume for each node
resource "aws_ebs_volume" "covenantsql_data" {
  count             = var.node_count
  availability_zone = data.aws_subnet.selected[count.index].availability_zone
  size              = var.storage_size_gb
  type              = "gp3"
  iops              = 3000
  throughput        = 125
  encrypted         = true

  tags = {
    Name        = "jeju-covenantsql-data-${var.environment}-${count.index}"
    Environment = var.environment
    Component   = "covenantsql"
    NodeIndex   = count.index
  }
}

data "aws_subnet" "selected" {
  count = var.node_count
  id    = var.subnet_ids[count.index % length(var.subnet_ids)]
}

# Launch Template for CovenantSQL nodes
resource "aws_launch_template" "covenantsql" {
  name_prefix   = "jeju-covenantsql-${var.environment}-"
  image_id      = data.aws_ami.amazon_linux_2.id
  instance_type = var.instance_type
  key_name      = var.key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.covenantsql.name
  }

  vpc_security_group_ids = [aws_security_group.covenantsql.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 30
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    environment           = var.environment
    node_count            = var.node_count
    private_key_ssm_param = var.private_key_ssm_param
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "jeju-covenantsql-${var.environment}"
      Environment = var.environment
      Component   = "covenantsql"
    }
  }

  tags = {
    Name        = "jeju-covenantsql-${var.environment}"
    Environment = var.environment
  }
}

# CovenantSQL Node Instances
resource "aws_instance" "covenantsql" {
  count = var.node_count

  launch_template {
    id      = aws_launch_template.covenantsql.id
    version = "$Latest"
  }

  subnet_id = var.subnet_ids[count.index % length(var.subnet_ids)]

  tags = {
    Name        = "jeju-covenantsql-${var.environment}-${count.index}"
    Environment = var.environment
    Component   = "covenantsql"
    NodeIndex   = count.index
  }
}

# Attach data volumes to instances
resource "aws_volume_attachment" "covenantsql_data" {
  count       = var.node_count
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.covenantsql_data[count.index].id
  instance_id = aws_instance.covenantsql[count.index].id
}

# Amazon Linux 2 AMI
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

# Internal Network Load Balancer for client connections
resource "aws_lb" "covenantsql" {
  name               = "jeju-covenantsql-${var.environment}"
  internal           = true
  load_balancer_type = "network"
  subnets            = var.subnet_ids

  enable_cross_zone_load_balancing = true

  tags = {
    Name        = "jeju-covenantsql-${var.environment}"
    Environment = var.environment
    Component   = "covenantsql"
  }
}

# Target Group for CovenantSQL client port
resource "aws_lb_target_group" "covenantsql_client" {
  name     = "jeju-covenantsql-client-${var.environment}"
  port     = 4661
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
    port                = 8546
    protocol            = "HTTP"
    path                = "/v1/health"
  }

  tags = {
    Name        = "jeju-covenantsql-client-${var.environment}"
    Environment = var.environment
  }
}

# Target Group for HTTP API
resource "aws_lb_target_group" "covenantsql_http" {
  name     = "jeju-covenantsql-http-${var.environment}"
  port     = 8546
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
    port                = 8546
    protocol            = "HTTP"
    path                = "/v1/health"
  }

  tags = {
    Name        = "jeju-covenantsql-http-${var.environment}"
    Environment = var.environment
  }
}

# Register instances with target groups
resource "aws_lb_target_group_attachment" "covenantsql_client" {
  count            = var.node_count
  target_group_arn = aws_lb_target_group.covenantsql_client.arn
  target_id        = aws_instance.covenantsql[count.index].id
  port             = 4661
}

resource "aws_lb_target_group_attachment" "covenantsql_http" {
  count            = var.node_count
  target_group_arn = aws_lb_target_group.covenantsql_http.arn
  target_id        = aws_instance.covenantsql[count.index].id
  port             = 8546
}

# Listeners
resource "aws_lb_listener" "covenantsql_client" {
  load_balancer_arn = aws_lb.covenantsql.arn
  port              = 4661
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.covenantsql_client.arn
  }
}

resource "aws_lb_listener" "covenantsql_http" {
  load_balancer_arn = aws_lb.covenantsql.arn
  port              = 8546
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.covenantsql_http.arn
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "covenantsql" {
  name              = "/jeju/covenantsql/${var.environment}"
  retention_in_days = 30

  tags = {
    Name        = "jeju-covenantsql-${var.environment}"
    Environment = var.environment
  }
}

# Outputs
output "lb_dns_name" {
  description = "DNS name of the CovenantSQL load balancer"
  value       = aws_lb.covenantsql.dns_name
}

output "client_endpoint" {
  description = "CovenantSQL client endpoint"
  value       = "${aws_lb.covenantsql.dns_name}:4661"
}

output "http_endpoint" {
  description = "CovenantSQL HTTP API endpoint"
  value       = "http://${aws_lb.covenantsql.dns_name}:8546"
}

output "node_ips" {
  description = "Private IPs of CovenantSQL nodes"
  value       = aws_instance.covenantsql[*].private_ip
}

output "security_group_id" {
  description = "Security group ID for CovenantSQL nodes"
  value       = aws_security_group.covenantsql.id
}

