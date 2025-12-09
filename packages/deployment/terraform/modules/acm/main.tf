# ACM Module - SSL Certificate Management
# Creates and validates SSL certificates using DNS validation

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Primary domain name (e.g., jeju.network)"
  type        = string
}

variable "zone_id" {
  description = "Route53 zone ID for DNS validation"
  type        = string
}

variable "subject_alternative_names" {
  description = "List of additional domain names for the certificate"
  type        = list(string)
  default     = []
}

variable "wait_for_validation" {
  description = "Whether to wait for certificate validation (set false for initial deploy before DNS is configured)"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

locals {
  # Build list of all domains to include in certificate
  all_domains = concat(
    [var.domain_name],
    var.subject_alternative_names,
    # Common subdomains for the environment
    [
      "*.${var.domain_name}",
      "${var.environment}.${var.domain_name}",
      "*.${var.environment}.${var.domain_name}",
    ]
  )

  # Deduplicate and filter
  unique_sans = distinct([for d in local.all_domains : d if d != var.domain_name])
}

# Request ACM certificate (must be in us-east-1 for CloudFront)
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = local.unique_sans
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(
    var.tags,
    {
      Name        = "jeju-${var.environment}-cert"
      Environment = var.environment
    }
  )
}

# Create DNS validation records in Route53
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.zone_id
}

# Wait for certificate validation (optional - can skip on initial deploy)
resource "aws_acm_certificate_validation" "main" {
  count = var.wait_for_validation ? 1 : 0

  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]

  timeouts {
    create = "45m"
  }
}

# Outputs
output "certificate_arn" {
  description = "ARN of the ACM certificate"
  # Return validated ARN if waiting, otherwise unvalidated
  value = var.wait_for_validation ? aws_acm_certificate_validation.main[0].certificate_arn : aws_acm_certificate.main.arn
}

output "certificate_domain_name" {
  description = "Primary domain name of the certificate"
  value       = aws_acm_certificate.main.domain_name
}

output "certificate_status" {
  description = "Status of the certificate"
  value       = aws_acm_certificate.main.status
}

output "domain_validation_options" {
  description = "Domain validation options (for debugging)"
  value       = aws_acm_certificate.main.domain_validation_options
}

