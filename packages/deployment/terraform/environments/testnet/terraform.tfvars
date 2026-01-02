# Testnet Infrastructure Variables
aws_region           = "us-east-1"
availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
domain_name          = "jejunetwork.org"
create_route53_zone  = true
enable_cdn           = true   # CDN enabled - ACM certificate validated
enable_dns_records   = true
wait_for_acm_validation = true   # ACM certificate is ISSUED
enable_https         = true   # HTTPS enabled - ACM certificate ISSUED

# SQLit ARM64 Configuration
# ARM64 (Graviton) instances provide ~40% cost savings
# Requires: SQLit image must be built and pushed to ECR first
# Run: NETWORK=testnet bun run images:sqlit:push
use_arm64_sqlit        = true
