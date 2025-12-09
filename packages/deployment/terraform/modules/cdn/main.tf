# CDN Module - S3 + CloudFront for Static Frontends
# Serves static assets with global CDN distribution

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Primary domain name (e.g., jeju.network)"
  type        = string
}

variable "apps" {
  description = "Frontend apps to host"
  type = list(object({
    name      = string
    subdomain = string # e.g., "gateway", "docs", "bazaar"
  }))
  default = [
    { name = "gateway", subdomain = "gateway" },
    { name = "documentation", subdomain = "docs" },
    { name = "bazaar", subdomain = "bazaar" }
  ]
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (must be in us-east-1 for CloudFront)"
  type        = string
}

variable "zone_id" {
  description = "Route53 zone ID for DNS records"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  app_domains = { for app in var.apps : app.name => "${app.subdomain}.${var.domain_name}" }
}

# S3 buckets for each app
resource "aws_s3_bucket" "app_buckets" {
  for_each = { for app in var.apps : app.name => app }

  bucket = "jeju-${var.environment}-${each.value.name}"

  # Allow deletion even with objects (required for clean teardown)
  # Only enabled for non-production environments
  force_destroy = var.environment != "mainnet"

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-${each.value.name}"
      Environment = var.environment
      App         = each.value.name
    }
  )
}

# Block public access (CloudFront will access via OAI)
resource "aws_s3_bucket_public_access_block" "app_buckets" {
  for_each = aws_s3_bucket.app_buckets

  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning
resource "aws_s3_bucket_versioning" "app_buckets" {
  for_each = aws_s3_bucket.app_buckets

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "app_buckets" {
  for_each = aws_s3_bucket.app_buckets

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudFront Origin Access Identity for each app
resource "aws_cloudfront_origin_access_identity" "app_oai" {
  for_each = { for app in var.apps : app.name => app }

  comment = "OAI for ${each.value.name} in ${var.environment}"
}

# S3 bucket policy to allow CloudFront OAI
resource "aws_s3_bucket_policy" "app_buckets" {
  for_each = aws_s3_bucket.app_buckets

  bucket = each.value.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAI"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.app_oai[each.key].iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "${each.value.arn}/*"
      }
    ]
  })
}

# CloudFront distributions
resource "aws_cloudfront_distribution" "app_distributions" {
  for_each = { for app in var.apps : app.name => app }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${each.value.name} - ${var.environment}"
  default_root_object = "index.html"
  price_class         = var.environment == "mainnet" ? "PriceClass_All" : "PriceClass_100"

  aliases = [local.app_domains[each.key]]

  origin {
    domain_name = aws_s3_bucket.app_buckets[each.key].bucket_regional_domain_name
    origin_id   = "S3-${each.key}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.app_oai[each.key].cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${each.key}"

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  # Cache behavior for static assets
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${each.key}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl                = 0
    default_ttl            = 31536000 # 1 year
    max_ttl                = 31536000
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  # Custom error responses for SPA routing
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-${each.key}-cdn"
      Environment = var.environment
      App         = each.key
    }
  )
}

# Route53 records for CloudFront distributions
resource "aws_route53_record" "app_records" {
  for_each = { for app in var.apps : app.name => app }

  zone_id = var.zone_id
  name    = each.value.subdomain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.app_distributions[each.key].domain_name
    zone_id                = aws_cloudfront_distribution.app_distributions[each.key].hosted_zone_id
    evaluate_target_health = false
  }
}

# Outputs
output "bucket_names" {
  description = "Map of app names to S3 bucket names"
  value       = { for k, v in aws_s3_bucket.app_buckets : k => v.id }
}

output "bucket_arns" {
  description = "Map of app names to S3 bucket ARNs"
  value       = { for k, v in aws_s3_bucket.app_buckets : k => v.arn }
}

output "cloudfront_distribution_ids" {
  description = "Map of app names to CloudFront distribution IDs"
  value       = { for k, v in aws_cloudfront_distribution.app_distributions : k => v.id }
}

output "cloudfront_domain_names" {
  description = "Map of app names to CloudFront domain names"
  value       = { for k, v in aws_cloudfront_distribution.app_distributions : k => v.domain_name }
}

output "app_urls" {
  description = "Map of app names to public URLs"
  value       = { for k, v in aws_route53_record.app_records : k => "https://${v.fqdn}" }
}

