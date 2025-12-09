# ECR Module - Container Registry for Jeju Apps
# Stores Docker images for all applications

variable "environment" {
  description = "Environment name (localnet, testnet, mainnet)"
  type        = string
}

variable "repositories" {
  description = "List of ECR repositories to create"
  type = list(object({
    name                 = string
    scan_on_push         = bool
    image_tag_mutability = string
  }))
  default = [
    {
      name                 = "jeju/bazaar"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/gateway"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/leaderboard"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/ipfs"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/documentation"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/crucible"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/ehorse"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/indexer-processor"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    },
    {
      name                 = "jeju/indexer-api"
      scan_on_push         = true
      image_tag_mutability = "MUTABLE"
    }
  ]
}

variable "lifecycle_policy" {
  description = "Lifecycle policy for images"
  type        = string
  default     = <<EOF
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 30 images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 30
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
EOF
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# Create ECR repositories
resource "aws_ecr_repository" "repos" {
  for_each = { for repo in var.repositories : repo.name => repo }

  name                 = each.value.name
  image_tag_mutability = each.value.image_tag_mutability

  # Allow deletion even with images (required for clean teardown)
  force_delete = var.environment != "mainnet"

  image_scanning_configuration {
    scan_on_push = each.value.scan_on_push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(
    var.tags,
    {
      Name        = each.value.name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  )
}

# Lifecycle policies
resource "aws_ecr_lifecycle_policy" "policy" {
  for_each = aws_ecr_repository.repos

  repository = each.value.name
  policy     = var.lifecycle_policy
}

# IAM policy for pull access (EKS nodes)
resource "aws_iam_policy" "ecr_pull" {
  name        = "jeju-${var.environment}-ecr-pull-policy"
  description = "Allow EKS nodes to pull images from ECR"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = [for repo in aws_ecr_repository.repos : repo.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-ecr-pull-policy"
      Environment = var.environment
    }
  )
}

# IAM policy for push access (CI/CD)
resource "aws_iam_policy" "ecr_push" {
  name        = "jeju-${var.environment}-ecr-push-policy"
  description = "Allow CI/CD to push images to ECR"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = [for repo in aws_ecr_repository.repos : repo.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-ecr-push-policy"
      Environment = var.environment
    }
  )
}

# Outputs
output "repository_urls" {
  description = "Map of repository names to URLs"
  value       = { for k, v in aws_ecr_repository.repos : k => v.repository_url }
}

output "repository_arns" {
  description = "Map of repository names to ARNs"
  value       = { for k, v in aws_ecr_repository.repos : k => v.arn }
}

output "pull_policy_arn" {
  description = "ARN of ECR pull policy"
  value       = aws_iam_policy.ecr_pull.arn
}

output "push_policy_arn" {
  description = "ARN of ECR push policy"
  value       = aws_iam_policy.ecr_push.arn
}

