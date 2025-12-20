# Testnet Infrastructure Variables
aws_region           = "us-east-1"
availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
domain_name          = "jeju.network"
create_route53_zone  = true
enable_cdn           = false  # Disable CDN for initial deploy
enable_dns_records   = true
wait_for_acm_validation = false  # Don't wait - cert may not be ready
enable_https         = false  # Enable after ACM validates

# CovenantSQL ARM64 Configuration
# ARM64 (Graviton) instances provide ~40% cost savings
# Requires: CQL image must be built and pushed to ECR first
# Run: NETWORK=testnet bun run images:cql:push
use_arm64_cql        = true
