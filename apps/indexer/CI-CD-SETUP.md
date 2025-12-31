# Indexer CI/CD Setup

## Overview

The indexer uses GitHub Actions for automated builds and deployments. The workflow builds a standalone bundle with all dependencies resolved, creating a minimal Docker image.

## Architecture

1. **Build Phase**: GitHub Actions runs `bun install && bun run build` in the monorepo root
2. **Bundle Phase**: The compiled `lib/` directory contains all resolved workspace dependencies
3. **Docker Phase**: A minimal image is created with just the built artifacts
4. **Deploy Phase**: Image is pushed to ECR and deployed to EKS

## Required GitHub Secrets

Set these in your GitHub repository settings (Settings → Secrets and variables → Actions):

### AWS Authentication
- `AWS_ROLE_ARN`: IAM role ARN with permissions for:
  - ECR: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`
  - EKS: `eks:DescribeCluster`
  - Access to the EKS cluster for kubectl operations

Example IAM role trust policy for GitHub OIDC:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::502713364895:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/jeju:*"
        }
      }
    }
  ]
}
```

## Triggering Deployments

### Automatic (on push)
The workflow automatically triggers on pushes to `main` that modify:
- `apps/indexer/**`
- `packages/**`
- `.github/workflows/deploy-indexer.yml`

### Manual
1. Go to Actions → Deploy Indexer
2. Click "Run workflow"
3. Select environment (testnet/mainnet)
4. Click "Run workflow"

## Image Tagging Strategy

- `testnet-latest`: Latest testnet build
- `testnet-<sha>`: Specific commit in testnet
- `mainnet-latest`: Latest mainnet build
- `mainnet-<sha>`: Specific commit in mainnet

## Files

- `.github/workflows/deploy-indexer.yml`: Main workflow definition
- `apps/indexer/Dockerfile.ci`: Simplified CI dockerfile
- `apps/indexer/.dockerignore.ci`: Docker build exclusions

## Rollback

To rollback to a previous version:
```bash
kubectl set image deployment/subsquid-api \
  api=502713364895.dkr.ecr.us-east-1.amazonaws.com/jeju/indexer-api:testnet-<old-sha> \
  -n indexer
```

## Local Testing

To test the CI build locally:
```bash
# Build
cd /path/to/jeju
bun install
cd apps/indexer
bun run build

# Build Docker image
docker build --platform linux/amd64 -f Dockerfile.ci -t indexer-test .

# Test run
docker run -it --rm -e MODE=api indexer-test
```

## Monitoring

After deployment:
```bash
# Check rollout status
kubectl rollout status deployment/subsquid-api -n indexer

# View logs
kubectl logs -n indexer -l app=subsquid-api --tail=50

# Check pod status
kubectl get pods -n indexer -l app=subsquid-api
```

## Code Changes Needed

The following files were modified to fix the 0.0.0.0 binding issue:
- `apps/indexer/api/rest-server.ts:723` - Added `hostname: '0.0.0.0'`
- `apps/indexer/api/a2a-server.ts:686` - Added `hostname: '0.0.0.0'`
- `apps/indexer/api/mcp-server.ts:702` - Added `hostname: '0.0.0.0'`

These changes ensure the servers bind to all interfaces, making them accessible via Kubernetes services.
