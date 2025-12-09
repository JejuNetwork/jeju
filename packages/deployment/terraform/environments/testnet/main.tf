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
  default     = "jeju.network"
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
  source = "../../modules/route53"

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
  source = "../../modules/acm"

  environment = local.environment
  domain_name = var.domain_name
  zone_id     = module.route53.zone_id

  # Set to false on first deploy, true after nameservers are updated at registrar
  wait_for_validation = var.wait_for_acm_validation

  subject_alternative_names = [
    "testnet.${var.domain_name}",
    "testnet-rpc.${var.domain_name}",
    "testnet-ws.${var.domain_name}",
    "gateway.testnet.${var.domain_name}",
    "bazaar.testnet.${var.domain_name}",
    "docs.testnet.${var.domain_name}",
    "api.testnet.${var.domain_name}",
  ]

  tags = local.common_tags

  depends_on = [module.route53]
}

# ============================================================
# Module: Networking (VPC, Subnets, NAT)
# ============================================================
module "network" {
  source = "../../modules/network"

  environment        = local.environment
  vpc_cidr           = "10.1.0.0/16"
  availability_zones = var.availability_zones
  tags               = local.common_tags
}

# ============================================================
# Module: EKS Cluster
# ============================================================
module "eks" {
  source = "../../modules/eks"

  environment        = local.environment
  cluster_version    = "1.29" # EKS requires incremental updates (1.28 -> 1.29 -> 1.30 -> 1.31)
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  node_groups = [
    {
      name          = "general"
      instance_type = "t3.large"
      desired_size  = 3
      min_size      = 2
      max_size      = 10
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
      instance_type = "t3.large"
      desired_size  = 2
      min_size      = 1
      max_size      = 4
      disk_size     = 100
      labels = {
        workload = "indexer"
      }
      taints = []
    }
  ]

  tags = local.common_tags
}

# ============================================================
# Module: RDS (PostgreSQL Databases)
# ============================================================
module "rds" {
  source = "../../modules/rds"

  environment             = local.environment
  vpc_id                  = module.network.vpc_id
  data_subnet_ids         = module.network.data_subnet_ids
  instance_class          = "db.t3.medium"
  allocated_storage       = 100
  max_allocated_storage   = 500
  engine_version          = "15.15" # Use latest PostgreSQL 15.x available
  multi_az                = true
  backup_retention_period = 7
  tags                    = local.common_tags
}

# ============================================================
# Module: ECR (Container Registry)
# ============================================================
module "ecr" {
  source = "../../modules/ecr"

  environment = local.environment
  tags        = local.common_tags
}

# ============================================================
# Module: KMS (Encryption Keys)
# ============================================================
module "kms" {
  source = "../../modules/kms"

  environment = local.environment
  tags        = local.common_tags
}

# ============================================================
# Module: WAF (Web Application Firewall)
# ============================================================
module "waf" {
  source = "../../modules/waf"

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
  source = "../../modules/alb"

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
# Module: CDN (S3 + CloudFront for Static Frontends)
# Only enabled when ACM certificate is validated
# ============================================================
module "cdn" {
  count  = var.enable_cdn ? 1 : 0
  source = "../../modules/cdn"

  environment         = local.environment
  domain_name         = var.domain_name
  zone_id             = module.route53.zone_id
  acm_certificate_arn = module.acm.certificate_arn

  apps = [
    { name = "gateway", subdomain = "gateway.testnet" },
    { name = "bazaar", subdomain = "bazaar.testnet" },
    { name = "documentation", subdomain = "docs.testnet" }
  ]

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

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.db_endpoint
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
    rpc     = "https://testnet-rpc.${var.domain_name}"
    ws      = "wss://testnet-ws.${var.domain_name}"
    api     = "https://api.testnet.${var.domain_name}"
    gateway = "https://gateway.testnet.${var.domain_name}"
    bazaar  = "https://bazaar.testnet.${var.domain_name}"
    docs    = "https://docs.testnet.${var.domain_name}"
  }
}

output "deployment_summary" {
  description = "Complete deployment summary"
  value = {
    environment         = local.environment
    region              = var.aws_region
    domain              = var.domain_name
    vpc_id              = module.network.vpc_id
    eks_cluster         = module.eks.cluster_name
    rds_endpoint        = module.rds.db_endpoint
    alb_endpoint        = module.alb.alb_dns_name
    route53_zone_id     = module.route53.zone_id
    acm_certificate_arn = module.acm.certificate_arn
    alb_controller_role = aws_iam_role.alb_controller.arn
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
    
    4. Deploy applications:
       cd packages/deployment && NETWORK=testnet bun run scripts/helmfile.ts sync
    
    5. Deploy contracts:
       bun run scripts/deploy/oif-multichain.ts --all
    ═══════════════════════════════════════════════════════════════════
  EOT
}
