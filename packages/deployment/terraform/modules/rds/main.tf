# RDS PostgreSQL for Subsquid Indexer

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "data_subnet_ids" {
  description = "Data subnet IDs for RDS"
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 100
}

variable "max_allocated_storage" {
  description = "Maximum allocated storage in GB for autoscaling"
  type        = number
  default     = 1000
}

variable "engine_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "16.1"
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment"
  type        = bool
  default     = true
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  name_prefix = "jeju-${var.environment}"
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = var.data_subnet_ids

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-db-subnet-group"
    Environment = var.environment
  })
}

# Security Group for RDS
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.main.cidr_block]
    description = "PostgreSQL from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-rds-sg"
    Environment = var.environment
  })
}

data "aws_vpc" "main" {
  id = var.vpc_id
}

# Parameter Group
resource "aws_db_parameter_group" "main" {
  name   = "${local.name_prefix}-pg15"
  family = "postgres15"

  # Static parameters (require reboot)
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "max_connections"
    value        = "500"
    apply_method = "pending-reboot"
  }

  # Dynamic parameters (apply immediately)
  parameter {
    name         = "log_statement"
    value        = "all"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_min_duration_statement"
    value        = "1000"
    apply_method = "immediate"
  }

  parameter {
    name         = "work_mem"
    value        = "32768"
    apply_method = "immediate"
  }

  parameter {
    name         = "maintenance_work_mem"
    value        = "2097152"
    apply_method = "immediate"
  }

  parameter {
    name         = "effective_cache_size"
    value        = "12582912"
    apply_method = "immediate"
  }

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-pg15"
    Environment = var.environment
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Random password for master user
resource "random_password" "master_password" {
  length  = 32
  special = true
}

# Store password in AWS Secrets Manager
resource "aws_secretsmanager_secret" "rds_master_password" {
  name        = "${local.name_prefix}-rds-master-password"
  description = "Master password for RDS PostgreSQL"

  # Allow immediate deletion for non-production (required for clean teardown)
  recovery_window_in_days = var.environment == "mainnet" ? 30 : 0

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-rds-master-password"
    Environment = var.environment
  })
}

resource "aws_secretsmanager_secret_version" "rds_master_password" {
  secret_id = aws_secretsmanager_secret.rds_master_password.id
  secret_string = jsonencode({
    username = "postgres"
    password = random_password.master_password.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
  })
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  # IOPS and throughput require >= 400GB storage, omit for smaller instances
  # iops                  = 3000
  # storage_throughput    = 125

  db_name  = "jeju"
  username = "postgres"
  password = random_password.master_password.result
  port     = 5432

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period = var.backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"

  # Skip final snapshot for non-production (required for clean teardown)
  skip_final_snapshot       = var.environment != "mainnet"
  final_snapshot_identifier = var.environment == "mainnet" ? "${local.name_prefix}-final-snapshot" : null

  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  deletion_protection = var.environment == "mainnet"

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-postgres"
    Environment = var.environment
  })
}

# Read Replica (for production environments)
resource "aws_db_instance" "read_replica" {
  count = var.environment == "mainnet" ? 1 : 0

  identifier          = "${local.name_prefix}-postgres-replica"
  replicate_source_db = aws_db_instance.main.identifier
  instance_class      = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  # IOPS and throughput require >= 400GB storage
  # iops                  = 3000
  # storage_throughput    = 125

  multi_az               = false
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-replica-final-snapshot"

  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = merge(var.tags, {
    Name        = "${local.name_prefix}-postgres-replica"
    Environment = var.environment
    Role        = "read-replica"
  })
}

# Outputs
output "db_instance_id" {
  description = "RDS instance ID"
  value       = aws_db_instance.main.id
}

output "db_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.main.endpoint
}

output "db_address" {
  description = "RDS address"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Master username"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "db_password_secret_arn" {
  description = "ARN of secret containing database password"
  value       = aws_secretsmanager_secret.rds_master_password.arn
}

output "db_security_group_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}

output "read_replica_endpoint" {
  description = "Read replica endpoint"
  value       = var.environment == "mainnet" ? aws_db_instance.read_replica[0].endpoint : null
}


