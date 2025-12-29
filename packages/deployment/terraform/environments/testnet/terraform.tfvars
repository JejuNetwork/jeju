# Testnet Infrastructure Variables
aws_region           = "us-east-1"
availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
domain_name          = "jejunetwork.org"
create_route53_zone  = true
enable_cdn           = false  # Disable CDN for initial deploy
enable_dns_records   = true
wait_for_acm_validation = false  # Don't wait - cert may not be ready
enable_https         = false  # Enable after ACM validates

# EQLite ARM64 Configuration
# ARM64 (Graviton) instances provide ~40% cost savings
# Requires: EQLite image must be built and pushed to ECR first
# Run: NETWORK=testnet bun run images:eqlite:push
use_arm64_eqlite        = true
