# Storage CDN Module - CloudFront distribution for decentralized storage gateway
# Provides fast, cached access to IPFS/storage content with JNS resolution

variable "enable_storage_cdn" {
  description = "Enable storage CDN gateway"
  type        = bool
  default     = true
}

variable "storage_gateway_origin" {
  description = "Origin URL for storage gateway (e.g., IPFS gateway or storage API)"
  type        = string
  default     = "gateway.jeju.network"
}

variable "jns_resolver_origin" {
  description = "JNS resolver API endpoint"
  type        = string
  default     = "jns-resolver.jeju.network"
}

variable "cache_ttl_default" {
  description = "Default cache TTL in seconds"
  type        = number
  default     = 86400 # 1 day
}

variable "cache_ttl_immutable" {
  description = "TTL for immutable content (IPFS CIDs)"
  type        = number
  default     = 31536000 # 1 year
}

# S3 bucket for caching storage content locally
resource "aws_s3_bucket" "storage_cache" {
  count = var.enable_storage_cdn ? 1 : 0

  bucket = "jeju-${var.environment}-storage-cache"

  force_destroy = var.environment != "mainnet"

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-storage-cache"
      Environment = var.environment
      Service     = "storage-cdn"
    }
  )
}

resource "aws_s3_bucket_lifecycle_configuration" "storage_cache" {
  count = var.enable_storage_cdn ? 1 : 0

  bucket = aws_s3_bucket.storage_cache[0].id

  rule {
    id     = "expire-cached-content"
    status = "Enabled"

    # Expire non-immutable cached content after 30 days
    expiration {
      days = 30
    }

    filter {
      prefix = "cache/"
    }
  }

  rule {
    id     = "retain-pinned-content"
    status = "Enabled"

    # Keep pinned content indefinitely (managed separately)
    filter {
      prefix = "pinned/"
    }
  }
}

# CloudFront distribution for storage gateway
resource "aws_cloudfront_distribution" "storage_cdn" {
  count = var.enable_storage_cdn ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Storage CDN Gateway - ${var.environment}"
  http_version        = "http2and3"
  price_class         = var.environment == "mainnet" ? "PriceClass_All" : "PriceClass_100"

  aliases = [
    "ipfs.${var.domain_name}",     # IPFS gateway (like dweb.link)
    "*.jns.${var.domain_name}",    # JNS wildcard (like *.eth.link)
    "storage.${var.domain_name}",  # Generic storage gateway
  ]

  # Primary origin: Storage gateway API
  origin {
    domain_name = var.storage_gateway_origin
    origin_id   = "storage-gateway"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }

    custom_header {
      name  = "X-CDN-Origin"
      value = "cloudfront"
    }
  }

  # Secondary origin: JNS resolver for name resolution
  origin {
    domain_name = var.jns_resolver_origin
    origin_id   = "jns-resolver"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default: Serve from storage gateway
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "storage-gateway"

    forwarded_values {
      query_string = true
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = var.cache_ttl_default
    max_ttl                = var.cache_ttl_immutable
    compress               = true
  }

  # IPFS content by CID - cache immutably
  ordered_cache_behavior {
    path_pattern     = "/ipfs/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "storage-gateway"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # IPFS CIDs are content-addressed, cache forever
    min_ttl                = var.cache_ttl_immutable
    default_ttl            = var.cache_ttl_immutable
    max_ttl                = var.cache_ttl_immutable
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    response_headers_policy_id = aws_cloudfront_response_headers_policy.immutable_cache[0].id
  }

  # IPNS names - shorter cache, needs resolution
  ordered_cache_behavior {
    path_pattern     = "/ipns/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "storage-gateway"

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }

    # IPNS can change, use shorter TTL
    min_ttl                = 0
    default_ttl            = 300  # 5 minutes
    max_ttl                = 3600 # 1 hour
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  # JNS resolution path
  ordered_cache_behavior {
    path_pattern     = "/jns/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "jns-resolver"

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }

    min_ttl                = 0
    default_ttl            = 60   # 1 minute
    max_ttl                = 300  # 5 minutes
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  # Static assets with hash - immutable
  ordered_cache_behavior {
    path_pattern     = "/*.[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "storage-gateway"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl                = var.cache_ttl_immutable
    default_ttl            = var.cache_ttl_immutable
    max_ttl                = var.cache_ttl_immutable
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    response_headers_policy_id = aws_cloudfront_response_headers_policy.immutable_cache[0].id
  }

  # API routes - no cache
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "storage-gateway"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "Origin"]

      cookies {
        forward = "all"
      }
    }

    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  # Custom error pages
  custom_error_response {
    error_code            = 404
    response_code         = 404
    error_caching_min_ttl = 60
    response_page_path    = "/404.html"
  }

  custom_error_response {
    error_code            = 502
    response_code         = 502
    error_caching_min_ttl = 10
    response_page_path    = "/502.html"
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

  # Web Application Firewall
  # web_acl_id = var.environment == "mainnet" ? aws_wafv2_web_acl.storage_cdn[0].arn : null

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-storage-cdn"
      Environment = var.environment
      Service     = "storage-cdn"
    }
  )
}

# Response headers policy for immutable content
resource "aws_cloudfront_response_headers_policy" "immutable_cache" {
  count = var.enable_storage_cdn ? 1 : 0

  name    = "jeju-${var.environment}-immutable-cache"
  comment = "Headers for immutable content (IPFS CIDs)"

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = true
    }
  }

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    origin_override = true
  }

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

# DNS records for storage CDN
resource "aws_route53_record" "storage_cdn_ipfs" {
  count = var.enable_storage_cdn ? 1 : 0

  zone_id = var.zone_id
  name    = "ipfs"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.storage_cdn[0].domain_name
    zone_id                = aws_cloudfront_distribution.storage_cdn[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "storage_cdn_storage" {
  count = var.enable_storage_cdn ? 1 : 0

  zone_id = var.zone_id
  name    = "storage"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.storage_cdn[0].domain_name
    zone_id                = aws_cloudfront_distribution.storage_cdn[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# JNS wildcard DNS
resource "aws_route53_record" "storage_cdn_jns_wildcard" {
  count = var.enable_storage_cdn ? 1 : 0

  zone_id = var.zone_id
  name    = "*.jns"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.storage_cdn[0].domain_name
    zone_id                = aws_cloudfront_distribution.storage_cdn[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# Outputs
output "storage_cdn_distribution_id" {
  description = "CloudFront distribution ID for storage CDN"
  value       = var.enable_storage_cdn ? aws_cloudfront_distribution.storage_cdn[0].id : null
}

output "storage_cdn_domain_name" {
  description = "CloudFront domain name for storage CDN"
  value       = var.enable_storage_cdn ? aws_cloudfront_distribution.storage_cdn[0].domain_name : null
}

output "storage_cdn_urls" {
  description = "Public URLs for storage CDN"
  value = var.enable_storage_cdn ? {
    ipfs    = "https://ipfs.${var.domain_name}"
    storage = "https://storage.${var.domain_name}"
    jns     = "https://*.jns.${var.domain_name}"
  } : null
}

output "storage_cache_bucket" {
  description = "S3 bucket for storage cache"
  value       = var.enable_storage_cdn ? aws_s3_bucket.storage_cache[0].id : null
}

