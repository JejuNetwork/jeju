# Mainnet environment (Ethereum) - Production L2

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }

  backend "s3" {
    bucket         = "jeju-terraform-state-mainnet"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "jeju-terraform-locks-mainnet"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "jeju-l3"
      Environment = "mainnet"
      ManagedBy   = "terraform"
      CostCenter  = "production"
      Settlement  = "ethereum-mainnet"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# Network module
module "network" {
  source = "../../modules/network"

  environment        = "mainnet"
  vpc_cidr           = "10.2.0.0/16"
  availability_zones = var.availability_zones
}

# EKS module
module "eks" {
  source = "../../modules/eks"

  environment        = "mainnet"
  cluster_version    = "1.31"
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  node_groups = [
    {
      name          = "core"
      instance_type = "m6a.4xlarge"
      min_size      = 3
      max_size      = 10
      desired_size  = 5
      disk_size     = 200
      labels        = { role = "core" }
      taints = [{
        key    = "workload"
        value  = "core"
        effect = "NoSchedule"
      }]
    },
    {
      name          = "rpc"
      instance_type = "m6a.4xlarge"
      min_size      = 5
      max_size      = 20
      desired_size  = 10
      disk_size     = 500
      labels        = { role = "rpc" }
      taints = [{
        key    = "workload"
        value  = "rpc"
        effect = "NoSchedule"
      }]
    },
    {
      name          = "data"
      instance_type = "r6a.2xlarge"
      min_size      = 3
      max_size      = 10
      desired_size  = 5
      disk_size     = 200
      labels        = { role = "data" }
      taints = [{
        key    = "workload"
        value  = "data"
        effect = "NoSchedule"
      }]
    }
  ]
}

# RDS module
module "rds" {
  source = "../../modules/rds"

  environment             = "mainnet"
  vpc_id                  = module.network.vpc_id
  data_subnet_ids         = module.network.data_subnet_ids
  instance_class          = "db.r6g.2xlarge"
  allocated_storage       = 500
  max_allocated_storage   = 5000
  multi_az                = true
  backup_retention_period = 30
}

# KMS module
module "kms" {
  source = "../../modules/kms"

  environment = "mainnet"
}

# Vault module
module "vault" {
  source = "../../modules/vault"

  environment       = "mainnet"
  namespace         = "infra"
  replicas          = 5
  vault_kms_key_id  = module.kms.vault_key_id
  storage_size      = "20Gi"
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.cluster_oidc_issuer_url
}

# WAF module (enabled for production)
module "waf" {
  source = "../../modules/waf"

  environment = "mainnet"
  enabled     = true
  rate_limit  = 10000 # Per 5 minutes per IP
}

# Outputs
output "vpc_id" {
  value = module.network.vpc_id
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value = module.rds.db_endpoint
}

output "vault_role_arn" {
  value = module.vault.vault_role_arn
}

output "waf_web_acl_arn" {
  description = "WAF Web ACL ARN for ALB"
  value       = module.waf.web_acl_arn
}


