# Jeju Network - AWS Testnet Environment
# Complete infrastructure orchestration - FULLY AUTOMATED

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
    bucket         = "jeju-terraform-state-testnet"
    key            = "testnet/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "jeju-terraform-locks-testnet"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Jeju Network"
      Environment = "testnet"
      ManagedBy   = "Terraform"
      Repository  = "github.com/JejuNetwork/jeju"
    }
  }
}

# ============================================================
# Variables
# ============================================================
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

variable "domain_name" {
  description = "Base domain name"
  type        = string
  default     = "jejunetwork.org"
}

variable "create_route53_zone" {
  description = "Whether to create a new Route53 zone (set false if zone already exists)"
  type        = bool
  default     = true
}

variable "enable_cdn" {
  description = "Enable CDN (CloudFront + S3). Set to false on initial deploy before ACM validates."
  type        = bool
  default     = true
}

variable "enable_solana" {
  description = "Enable Solana RPC nodes (optional, requires EC2 quota + keypair)"
  type        = bool
  default     = false
}

variable "enable_dns_records" {
  description = "Create DNS records for services. Requires valid ACM certificate."
  type        = bool
  default     = true
}

variable "wait_for_acm_validation" {
  description = "Wait for ACM certificate validation. Set false on first deploy before nameservers are updated."
  type        = bool
  default     = true
}

variable "enable_https" {
  description = "Enable HTTPS on ALB. Requires validated ACM certificate."
  type        = bool
  default     = true
}

# Contract addresses are now configured in DWS services
# via environment variables or jeju.config.json

# NOTE: SQLit is now deployed via DWS, not Terraform
# Use: jeju infra deploy sqlit --network testnet

locals {
  environment = "testnet"

  common_tags = {
    Project     = "Jeju Network"
    Environment = "testnet"
    ManagedBy   = "Terraform"
  }
}

# ============================================================
# Module: Route53 (DNS Hosted Zone) - CREATED FIRST
# ============================================================
module "route53" {
  source = "../../modules/aws/route53"

  environment = local.environment
  domain_name = var.domain_name
  create_zone = var.create_route53_zone
  tags        = local.common_tags
}

# ============================================================
# Module: ACM (SSL Certificate) - Depends on Route53
# Set wait_for_validation=false on first deploy, true after NS update
# ============================================================
module "acm" {
  source = "../../modules/aws/acm"

  environment = local.environment
  domain_name = var.domain_name
  zone_id     = module.route53.zone_id

  # Use existing certificate for jejunetwork.org (already validated and issued)
  existing_certificate_arn = "arn:aws:acm:us-east-1:502713364895:certificate/34c89eb5-a94f-406a-be3c-c40008f4f693"

  # Set to false on first deploy, true after nameservers are updated at registrar
  wait_for_validation = var.wait_for_acm_validation

  subject_alternative_names = [
    "testnet.${var.domain_name}",
    "testnet-rpc.${var.domain_name}",
    "testnet-ws.${var.domain_name}",
    # WILDCARD: Enables permissionless JNS-based app deployment
    # Any app registered via JNS (babylon.jeju, myapp.jeju) automatically gets HTTPS
    "*.testnet.${var.domain_name}",
    # Legacy explicit entries (kept for backwards compatibility)
    "gateway.testnet.${var.domain_name}",
    "bazaar.testnet.${var.domain_name}",
    "autocrat.testnet.${var.domain_name}",
    "crucible.testnet.${var.domain_name}",
    "oauth3.testnet.${var.domain_name}",
    "docs.testnet.${var.domain_name}",
    "api.testnet.${var.domain_name}",
    "dws.testnet.${var.domain_name}",
    "storage.testnet.${var.domain_name}",
    "git.testnet.${var.domain_name}",
    "npm.testnet.${var.domain_name}",
    "hub.testnet.${var.domain_name}",
    "registry.testnet.${var.domain_name}",
    "jns.testnet.${var.domain_name}",
    "*.jns.testnet.${var.domain_name}",
    "indexer.testnet.${var.domain_name}",
    "bundler.testnet.${var.domain_name}",
    "explorer.testnet.${var.domain_name}",
    "faucet.testnet.${var.domain_name}",
    "ipfs.testnet.${var.domain_name}",
    "ipfs-api.testnet.${var.domain_name}",
  ]

  tags = local.common_tags

  depends_on = [module.route53]
}

# ============================================================
# Module: Networking (VPC, Subnets, NAT)
# ============================================================
module "network" {
  source = "../../modules/aws/network"

  environment        = local.environment
  vpc_cidr           = "10.1.0.0/16"
  availability_zones = var.availability_zones
  tags               = local.common_tags
}

# ============================================================
# Module: EKS Cluster
# ============================================================
module "eks" {
  source = "../../modules/aws/eks"

  environment        = local.environment
  cluster_version    = "1.29" # EKS requires incremental updates (1.28 -> 1.29 -> 1.30 -> 1.31)
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  node_groups = [
    {
      name          = "general"
      instance_type = "t3.xlarge"  # Upgraded from t3.large for more CPU (4 vCPU)
      desired_size  = 6
      min_size      = 2
      max_size      = 12
      disk_size     = 50
      labels = {
        workload = "general"
      }
      taints = []
    },
    {
      name          = "rpc"
      instance_type = "t3.xlarge"
      desired_size  = 2
      min_size      = 1
      max_size      = 5
      disk_size     = 100
      labels = {
        workload = "rpc"
      }
      taints = [
        {
          key    = "workload"
          value  = "rpc"
          effect = "NO_SCHEDULE"
        }
      ]
    },
    {
      name          = "indexer"
      instance_type = "t3.xlarge"  # Upgraded for L1 node workloads
      desired_size  = 2
      min_size      = 1
      max_size      = 4
      disk_size     = 200  # More disk for blockchain data
      labels = {
        workload = "indexer"
      }
      taints = []
    }
  ]

  tags = local.common_tags
}

# ============================================================
# Module: ECR (Container Registry)
# TRANSITIONAL: Used only for infrastructure bootstrap images (sqlit, ipfs)
# Apps deploy to DWS Storage (IPFS) - see packages/deployment/scripts/dws-bootstrap.ts
# Target: Migrate to fully decentralized OCI registry at registry.jeju
# ============================================================
module "ecr" {
  source = "../../modules/aws/ecr"

  environment = local.environment
  tags        = local.common_tags
}

# ============================================================
# Module: KMS (Encryption Keys)
# ============================================================
module "kms" {
  source = "../../modules/aws/kms"

  environment = local.environment
  tags        = local.common_tags
}

# ============================================================
# Module: WAF (Web Application Firewall)
# ============================================================
module "waf" {
  source = "../../modules/aws/waf"

  environment = local.environment
  enabled     = true
  rate_limit  = 2000 # requests per 5 minutes
  tags        = local.common_tags
}

# ============================================================
# Module: ALB (Application Load Balancer)
# enable_https=false until ACM certificate is validated
# ============================================================
module "alb" {
  source = "../../modules/aws/alb"

  environment         = local.environment
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  acm_certificate_arn = module.acm.certificate_arn
  enable_https        = var.enable_https
  enable_waf          = true
  waf_web_acl_arn     = module.waf.web_acl_arn
  tags                = local.common_tags

  depends_on = [module.network, module.acm, module.waf]
}

# ============================================================
# Module: CDN - DEPRECATED for Apps
# 
# ALL apps now deploy to DWS and are served via DWS CDN (decentralized).
# This CloudFront module is ONLY kept for non-app infrastructure assets
# (e.g., training data, large static files that benefit from edge caching).
#
# App deployment flow:
#   1. Frontend built and uploaded to IPFS via DWS storage
#   2. JNS name registered on-chain (e.g., bazaar.jeju)
#   3. DWS CDN nodes serve content from IPFS
#   4. DWS ingress routes requests to frontend or backend workers
#
# DO NOT add apps to this module - deploy via DWS instead:
#   NETWORK=testnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts
# ============================================================
module "cdn" {
  count  = var.enable_cdn ? 1 : 0
  source = "../../modules/aws/cdn"

  environment         = local.environment
  domain_name         = var.domain_name
  zone_id             = module.route53.zone_id
  acm_certificate_arn = module.acm.certificate_arn

  # NO APPS - All apps deploy via DWS (decentralized)
  # Only infrastructure assets that need centralized CDN go here
  apps = []

  tags = local.common_tags

  depends_on = [module.route53, module.acm]
}

# ============================================================
# Route53 Records for ALB
# Only created when DNS records are enabled
# ============================================================
resource "aws_route53_record" "rpc" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "testnet-rpc"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "ws" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "testnet-ws"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "api" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "api.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "testnet_main" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

# DWS Services DNS Records
resource "aws_route53_record" "dws" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "dws.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "storage" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "storage.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "git" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "git.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "jns" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "jns.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "jns_wildcard" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "*.jns.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "indexer" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "indexer.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "bundler" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "bundler.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "explorer" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "explorer.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

# DWS-hosted Apps DNS Records (routed through DWS app router)
# These apps are served via DWS: frontend from IPFS, backend via DWS workers/proxy
resource "aws_route53_record" "gateway" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "gateway.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "bazaar" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "bazaar.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "autocrat" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "autocrat.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "crucible" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "crucible.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

resource "aws_route53_record" "oauth3" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "oauth3.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

# =============================================================================
# WILDCARD DNS RECORD - Enables Permissionless JNS-Based App Deployment
# Any app registered via JNS automatically routes here without Terraform changes
# DWS handles hostname-based routing internally via JNS resolution
# =============================================================================
resource "aws_route53_record" "testnet_wildcard" {
  count   = var.enable_dns_records ? 1 : 0
  zone_id = module.route53.zone_id
  name    = "*.testnet"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.route53, module.alb]
}

# ============================================================
# Kubernetes Provider Configuration
# Configured AFTER EKS is created
# ============================================================
data "aws_eks_cluster" "cluster" {
  name       = module.eks.cluster_name
  depends_on = [module.eks]
}

data "aws_eks_cluster_auth" "cluster" {
  name       = module.eks.cluster_name
  depends_on = [module.eks]
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.cluster.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.cluster.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.cluster.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.cluster.token
  }
}

# ============================================================
# Kubernetes Resources - AWS Load Balancer Controller IAM
# ============================================================
resource "aws_iam_policy" "alb_controller" {
  name        = "jeju-${local.environment}-alb-controller-policy"
  description = "IAM policy for AWS Load Balancer Controller"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iam:CreateServiceLinkedRole"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "iam:AWSServiceName" = "elasticloadbalancing.amazonaws.com"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeAccountAttributes",
          "ec2:DescribeAddresses",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeInternetGateways",
          "ec2:DescribeVpcs",
          "ec2:DescribeVpcPeeringConnections",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeInstances",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeTags",
          "ec2:GetCoipPoolUsage",
          "ec2:DescribeCoipPools",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeListenerCertificates",
          "elasticloadbalancing:DescribeSSLPolicies",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetGroupAttributes",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:DescribeTags"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:DescribeUserPoolClient",
          "acm:ListCertificates",
          "acm:DescribeCertificate",
          "iam:ListServerCertificates",
          "iam:GetServerCertificate",
          "waf-regional:GetWebACL",
          "waf-regional:GetWebACLForResource",
          "waf-regional:AssociateWebACL",
          "waf-regional:DisassociateWebACL",
          "wafv2:GetWebACL",
          "wafv2:GetWebACLForResource",
          "wafv2:AssociateWebACL",
          "wafv2:DisassociateWebACL",
          "shield:GetSubscriptionState",
          "shield:DescribeProtection",
          "shield:CreateProtection",
          "shield:DeleteProtection"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateSecurityGroup"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateTags"
        ]
        Resource = "arn:aws:ec2:*:*:security-group/*"
        Condition = {
          StringEquals = {
            "ec2:CreateAction" = "CreateSecurityGroup"
          }
          Null = {
            "aws:RequestTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateTags",
          "ec2:DeleteTags"
        ]
        Resource = "arn:aws:ec2:*:*:security-group/*"
        Condition = {
          Null = {
            "aws:RequestTag/elbv2.k8s.aws/cluster"  = "true"
            "aws:ResourceTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:DeleteSecurityGroup"
        ]
        Resource = "*"
        Condition = {
          Null = {
            "aws:ResourceTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:CreateLoadBalancer",
          "elasticloadbalancing:CreateTargetGroup"
        ]
        Resource = "*"
        Condition = {
          Null = {
            "aws:RequestTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:CreateListener",
          "elasticloadbalancing:DeleteListener",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:DeleteRule"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:AddTags",
          "elasticloadbalancing:RemoveTags"
        ]
        Resource = [
          "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
          "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
          "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*"
        ]
        Condition = {
          Null = {
            "aws:RequestTag/elbv2.k8s.aws/cluster"  = "true"
            "aws:ResourceTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:AddTags",
          "elasticloadbalancing:RemoveTags"
        ]
        Resource = [
          "arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*",
          "arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*",
          "arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*",
          "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:ModifyLoadBalancerAttributes",
          "elasticloadbalancing:SetIpAddressType",
          "elasticloadbalancing:SetSecurityGroups",
          "elasticloadbalancing:SetSubnets",
          "elasticloadbalancing:DeleteLoadBalancer",
          "elasticloadbalancing:ModifyTargetGroup",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:DeleteTargetGroup"
        ]
        Resource = "*"
        Condition = {
          Null = {
            "aws:ResourceTag/elbv2.k8s.aws/cluster" = "false"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets"
        ]
        Resource = "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:SetWebAcl",
          "elasticloadbalancing:ModifyListener",
          "elasticloadbalancing:AddListenerCertificates",
          "elasticloadbalancing:RemoveListenerCertificates",
          "elasticloadbalancing:ModifyRule"
        ]
        Resource = "*"
      }
    ]
  })

  tags = local.common_tags
}

# IRSA for ALB Controller
data "aws_iam_policy_document" "alb_controller_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks.cluster_oidc_issuer_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }

    principals {
      identifiers = [module.eks.oidc_provider_arn]
      type        = "Federated"
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "jeju-${local.environment}-alb-controller-role"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume_role.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  policy_arn = aws_iam_policy.alb_controller.arn
  role       = aws_iam_role.alb_controller.name
}

# ============================================================
# Outputs
# ============================================================
output "vpc_id" {
  description = "VPC ID"
  value       = module.network.vpc_id
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "ecr_repository_urls" {
  description = "ECR repository URLs"
  value       = module.ecr.repository_urls
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.alb.alb_dns_name
}

output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = module.route53.zone_id
}

output "route53_nameservers" {
  description = "Route53 nameservers - UPDATE AT DOMAIN REGISTRAR"
  value       = module.route53.nameservers
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = module.acm.certificate_arn
}

output "cloudfront_urls" {
  description = "CloudFront distribution URLs"
  value       = var.enable_cdn ? module.cdn[0].app_urls : {}
}

output "alb_controller_role_arn" {
  description = "IAM role ARN for AWS Load Balancer Controller"
  value       = aws_iam_role.alb_controller.arn
}

output "testnet_urls" {
  description = "Testnet service URLs"
  value = {
    rpc        = "https://testnet-rpc.${var.domain_name}"
    ws         = "wss://testnet-ws.${var.domain_name}"
    api        = "https://api.testnet.${var.domain_name}"
    gateway    = "https://gateway.testnet.${var.domain_name}"
    bazaar     = "https://bazaar.testnet.${var.domain_name}"
    autocrat   = "https://autocrat.testnet.${var.domain_name}"
    crucible   = "https://crucible.testnet.${var.domain_name}"
    oauth3     = "https://oauth3.testnet.${var.domain_name}"
    docs       = "https://docs.testnet.${var.domain_name}"
    # Messaging, Hubble, SQLit, and Email now deployed via DWS (decentralized)
    # Use: jeju infra deploy <service> to provision these services
    dws        = "https://dws.testnet.${var.domain_name}"
    solana_rpc = var.enable_solana ? module.solana[0].rpc_endpoint : ""
    solana_ws  = var.enable_solana ? module.solana[0].ws_endpoint : ""
  }
}

# DWS-deployed services configuration
# These services are now deployed via DWS instead of Terraform modules:
# - Messaging (messaging-relay, kms-api)
# - SQLit (distributed database)
# - Farcaster Hubble
# - Email infrastructure
# 
# Deploy with: jeju infra deploy <service> --network testnet
# List with: jeju infra list --network testnet

# ============================================================
# DECENTRALIZED SERVICES (deployed via DWS)
# ============================================================
# The following services are now deployed via DWS instead of Terraform:
# - SQLit: Decentralized distributed database
# - Farcaster Hubble: Farcaster protocol hub
# - Messaging: Relay nodes and KMS
# - Email: SMTP/IMAP infrastructure
#
# To deploy these services:
#   jeju infra deploy sqlit --network testnet
#   jeju infra deploy hubble --network testnet
#   jeju infra deploy messaging --network testnet
#   jeju infra deploy email --network testnet
#
# DWS handles:
# - Node selection and load balancing
# - On-chain registration and staking
# - Health monitoring and auto-recovery
# - IPFS-based persistence and backup
# ============================================================

# ============================================================
# Module: Solana RPC Nodes (Cross-chain Bridge Infrastructure)
# Required for EVM <-> Solana arbitrage, LP management, and OIF
# ============================================================
module "solana" {
  source = "../../modules/aws/solana"
  count  = var.enable_solana ? 1 : 0

  environment    = local.environment
  vpc_id         = module.network.vpc_id
  subnet_ids     = module.network.public_subnet_ids
  solana_network = "devnet"  # Use devnet for testnet
  node_count     = 2
  instance_type  = "r6i.2xlarge"  # Solana needs significant resources
  disk_size_gb   = 500            # Smaller for devnet
  key_name       = "jeju-testnet"
  tags           = local.common_tags

  depends_on = [module.network]
}

output "solana_rpc_endpoint" {
  description = "Solana RPC endpoint for cross-chain operations"
  value       = var.enable_solana ? module.solana[0].rpc_endpoint : ""
}

output "solana_ws_endpoint" {
  description = "Solana WebSocket endpoint"
  value       = var.enable_solana ? module.solana[0].ws_endpoint : ""
}

# Email infrastructure is now deployed via DWS
# Deploy with: jeju infra deploy email --network testnet

output "deployment_summary" {
  description = "Complete deployment summary"
  value = {
    environment         = local.environment
    region              = var.aws_region
    domain              = var.domain_name
    vpc_id              = module.network.vpc_id
    eks_cluster         = module.eks.cluster_name
    alb_endpoint        = module.alb.alb_dns_name
    route53_zone_id     = module.route53.zone_id
    acm_certificate_arn = module.acm.certificate_arn
    alb_controller_role = aws_iam_role.alb_controller.arn
    dws_endpoint        = "https://dws.testnet.${var.domain_name}"
    solana_rpc          = var.enable_solana ? module.solana[0].rpc_endpoint : ""
  }
}

output "next_steps" {
  description = "Post-deployment instructions"
  value       = <<-EOT
    ═══════════════════════════════════════════════════════════════════
    DEPLOYMENT COMPLETE - Next Steps:
    ═══════════════════════════════════════════════════════════════════
    
    1. UPDATE DOMAIN NAMESERVERS at your registrar to:
       ${join("\n       ", module.route53.nameservers)}
    
    2. Configure kubectl:
       aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.aws_region}
    
    3. Install AWS Load Balancer Controller:
       helm repo add eks https://aws.github.io/eks-charts
       helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
         -n kube-system \
         --set clusterName=${module.eks.cluster_name} \
         --set serviceAccount.create=true \
         --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=${aws_iam_role.alb_controller.arn}
    
    4. Deploy DWS infrastructure services:
       jeju infra deploy sqlit --network testnet
       jeju infra deploy hubble --network testnet
       jeju infra deploy messaging --network testnet
       jeju infra deploy email --network testnet
    
    5. Deploy applications via DWS:
       NETWORK=testnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts
    
    6. Deploy contracts:
       bun run scripts/deploy/oif-multichain.ts --all
    ═══════════════════════════════════════════════════════════════════
  EOT
}
