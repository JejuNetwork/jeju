# ALB Module - Application Load Balancer for EKS Services
# Routes traffic to backend services (RPC, API, etc.)

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB"
  type        = list(string)
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}

variable "enable_https" {
  description = "Enable HTTPS listener (requires validated ACM certificate)"
  type        = bool
  default     = true
}

variable "enable_waf" {
  description = "Enable WAF on ALB"
  type        = bool
  default     = true
}

variable "waf_web_acl_arn" {
  description = "WAF Web ACL ARN"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply"
  type        = map(string)
  default     = {}
}

# Security group for ALB
resource "aws_security_group" "alb" {
  name_prefix = "jeju-${var.environment}-alb-"
  description = "Security group for Jeju ALB"
  vpc_id      = var.vpc_id

  # HTTP
  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow all outbound
  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-alb-sg"
      Environment = var.environment
    }
  )

  lifecycle {
    create_before_destroy = true
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "jeju-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection       = var.environment == "mainnet" ? true : false
  enable_http2                     = true
  enable_cross_zone_load_balancing = true

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-alb"
      Environment = var.environment
    }
  )
}

# Associate WAF if enabled
resource "aws_wafv2_web_acl_association" "alb" {
  count = var.enable_waf && var.waf_web_acl_arn != "" ? 1 : 0

  resource_arn = aws_lb.main.arn
  web_acl_arn  = var.waf_web_acl_arn
}

# Target groups for common services
resource "aws_lb_target_group" "rpc" {
  name     = "jeju-${var.environment}-rpc-tg"
  port     = 8545
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-rpc-tg"
      Environment = var.environment
      Service     = "rpc"
    }
  )
}

resource "aws_lb_target_group" "indexer" {
  name     = "jeju-${var.environment}-indexer-tg"
  port     = 4350
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-indexer-tg"
      Environment = var.environment
      Service     = "indexer"
    }
  )
}

# HTTP listener (redirect to HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener (conditional - only when certificate is validated)
resource "aws_lb_listener" "https" {
  count = var.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Jeju Network - ${var.environment}"
      status_code  = "200"
    }
  }
}

# Listener rules for routing (conditional on HTTPS being enabled)
resource "aws_lb_listener_rule" "rpc" {
  count = var.enable_https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.rpc.arn
  }

  condition {
    host_header {
      values = ["rpc.${var.environment == "mainnet" ? "" : "${var.environment}."}jeju.network"]
    }
  }
}

resource "aws_lb_listener_rule" "indexer" {
  count = var.enable_https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 110

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.indexer.arn
  }

  condition {
    host_header {
      values = ["indexer.${var.environment == "mainnet" ? "" : "${var.environment}."}jeju.network"]
    }
  }
}

# Outputs
output "alb_arn" {
  description = "ARN of the load balancer"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "security_group_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "target_group_arns" {
  description = "Map of service names to target group ARNs"
  value = {
    rpc     = aws_lb_target_group.rpc.arn
    indexer = aws_lb_target_group.indexer.arn
  }
}

output "https_listener_arn" {
  description = "ARN of HTTPS listener for adding custom rules"
  value       = var.enable_https ? aws_lb_listener.https[0].arn : ""
}

