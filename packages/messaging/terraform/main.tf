# Jeju Messaging Infrastructure - AWS Terraform
#
# This module deploys:
# - ECS Fargate service for relay nodes
# - Application Load Balancer
# - ElastiCache Redis for message queuing
# - CloudWatch for monitoring
#
# Usage:
#   cd terraform
#   terraform init
#   terraform plan
#   terraform apply

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ============ Variables ============

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "testnet"
}

variable "node_count" {
  description = "Number of relay nodes"
  type        = number
  default     = 3
}

variable "jeju_rpc_url" {
  description = "Jeju L2 RPC URL"
  type        = string
  default     = "https://testnet-rpc.jeju.network"
}

variable "node_registry_address" {
  description = "MessageNodeRegistry contract address"
  type        = string
}

variable "key_registry_address" {
  description = "KeyRegistry contract address"
  type        = string
}

variable "operator_private_key" {
  description = "Private key for node operator"
  type        = string
  sensitive   = true
}

# ============ Provider ============

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "jeju-messaging"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ============ Data Sources ============

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# ============ VPC ============

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "jeju-messaging-${var.environment}"
  }
}

resource "aws_subnet" "public" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  map_public_ip_on_launch = true
  
  tags = {
    Name = "jeju-messaging-public-${count.index + 1}"
  }
}

resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name = "jeju-messaging-private-${count.index + 1}"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = {
    Name = "jeju-messaging-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  
  tags = {
    Name = "jeju-messaging-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ============ Security Groups ============

resource "aws_security_group" "alb" {
  name        = "jeju-messaging-alb-${var.environment}"
  description = "ALB security group"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "jeju-messaging-ecs-${var.environment}"
  description = "ECS tasks security group"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port       = 3200
    to_port         = 3200
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ============ ECS Cluster ============

resource "aws_ecs_cluster" "main" {
  name = "jeju-messaging-${var.environment}"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  
  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ============ ECR Repository ============

resource "aws_ecr_repository" "relay_node" {
  name                 = "jeju-messaging-relay"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
}

# ============ IAM Roles ============

resource "aws_iam_role" "ecs_task_execution" {
  name = "jeju-messaging-task-execution-${var.environment}"
  
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
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "jeju-messaging-task-${var.environment}"
  
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
}

# ============ CloudWatch Logs ============

resource "aws_cloudwatch_log_group" "relay_node" {
  name              = "/ecs/jeju-messaging-relay-${var.environment}"
  retention_in_days = 30
}

# ============ ECS Task Definition ============

resource "aws_ecs_task_definition" "relay_node" {
  family                   = "jeju-messaging-relay-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([{
    name  = "relay-node"
    image = "${aws_ecr_repository.relay_node.repository_url}:latest"
    
    portMappings = [{
      containerPort = 3200
      hostPort      = 3200
      protocol      = "tcp"
    }]
    
    environment = [
      { name = "PORT", value = "3200" },
      { name = "NODE_ENV", value = var.environment },
      { name = "JEJU_RPC_URL", value = var.jeju_rpc_url },
      { name = "NODE_REGISTRY_ADDRESS", value = var.node_registry_address },
      { name = "KEY_REGISTRY_ADDRESS", value = var.key_registry_address },
    ]
    
    secrets = [
      {
        name      = "OPERATOR_PRIVATE_KEY"
        valueFrom = aws_secretsmanager_secret.operator_key.arn
      }
    ]
    
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.relay_node.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "relay"
      }
    }
    
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3200/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])
}

# ============ Application Load Balancer ============

resource "aws_lb" "main" {
  name               = "jeju-messaging-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  
  enable_deletion_protection = var.environment == "mainnet"
}

resource "aws_lb_target_group" "relay" {
  name        = "jeju-msg-relay-${var.environment}"
  port        = 3200
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
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
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.relay.arn
  }
}

# ============ ECS Service ============

resource "aws_ecs_service" "relay_node" {
  name            = "jeju-messaging-relay"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.relay_node.arn
  desired_count   = var.node_count
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  
  load_balancer {
    target_group_arn = aws_lb_target_group.relay.arn
    container_name   = "relay-node"
    container_port   = 3200
  }
  
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  
  depends_on = [aws_lb_listener.http]
}

# ============ Secrets Manager ============

resource "aws_secretsmanager_secret" "operator_key" {
  name = "jeju-messaging-operator-key-${var.environment}"
}

resource "aws_secretsmanager_secret_version" "operator_key" {
  secret_id     = aws_secretsmanager_secret.operator_key.id
  secret_string = var.operator_private_key
}

# ============ Auto Scaling ============

resource "aws_appautoscaling_target" "relay" {
  max_capacity       = 10
  min_capacity       = var.node_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.relay_node.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "relay_cpu" {
  name               = "jeju-messaging-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.relay.resource_id
  scalable_dimension = aws_appautoscaling_target.relay.scalable_dimension
  service_namespace  = aws_appautoscaling_target.relay.service_namespace
  
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ============ Outputs ============

output "alb_dns_name" {
  description = "ALB DNS name for relay nodes"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for relay node images"
  value       = aws_ecr_repository.relay_node.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "relay_endpoint" {
  description = "Relay node endpoint"
  value       = "http://${aws_lb.main.dns_name}"
}

