# Jeju Network - Testnet Terraform Variables
# Override defaults for testnet-specific configuration

aws_region = "us-east-1"

availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

domain_name = "jeju.network"

# Route53 Zone Settings
# Set to true to create a new Route53 hosted zone
# Set to false if the zone already exists (e.g., from a previous deployment)
create_route53_zone = true

# ACM Certificate Validation
# Set to false on FIRST deploy before updating domain nameservers
# After nameservers are updated and propagated, set back to true
# This prevents terraform from blocking indefinitely waiting for DNS validation
wait_for_acm_validation = false

# HTTPS Listener
# Set to false until ACM certificate is validated
# This allows ALB to be created without HTTPS until certificate is ready
enable_https = false

# CDN Settings
# Set to true to enable CloudFront + S3 CDN for static frontends
# Requires ACM certificate to be validated - leave false until certificate is issued
enable_cdn = false

# DNS Record Settings  
# Set to true to create Route53 DNS records for services
# These can be created before certificate is validated
enable_dns_records = true
