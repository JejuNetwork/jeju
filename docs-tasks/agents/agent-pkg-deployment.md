# Agent Task: Deployment Package Documentation

## Scope
Research and document the Deployment package (`packages/deployment/`).

## Source Files to Analyze
- `packages/deployment/kubernetes/` - K8s manifests
- `packages/deployment/terraform/` - Terraform configs
- `packages/deployment/docker/` - Docker configs
- `packages/deployment/kurtosis/` - Kurtosis configs
- `packages/deployment/scripts/` - Deployment scripts
- `packages/deployment/README.md` - Existing docs

## Research Questions
1. What deployment targets are supported?
2. How does Kubernetes deployment work?
3. How does Terraform infrastructure work?
4. How does Kurtosis local dev work?
5. What Helm charts exist?
6. How are secrets managed?
7. What monitoring is included?
8. How do upgrades work?

## Output Format

### File: `apps/documentation/packages/deployment.md`

```markdown
# Deployment Package

[One-sentence description - infrastructure and deployment configs]

## Overview

[Deployment options, environments, infrastructure]

## Deployment Targets

### Local (Kurtosis)
[Local development with Kurtosis]

### Docker Compose
[Single-node deployment]

### Kubernetes
[Production deployment]

### Cloud (Terraform)
[AWS/GCP/Azure provisioning]

## Kubernetes

### Helm Charts
[Available charts, values]

### Services
[Services deployed by each chart]

### Configuration
[ConfigMaps, Secrets]

## Terraform

### Modules
[AWS, GCP, Azure modules]

### Variables
[Required variables]

## Kurtosis

\`\`\`bash
kurtosis run . --args-file network_params.yaml
\`\`\`

## Secrets Management

[How secrets are handled]

## Monitoring

[Prometheus, Grafana integration]

## Upgrades

[Rolling upgrades, blue-green]

## Related

- [Deployment Overview](/deployment/overview)
- [Infrastructure](/deployment/infrastructure)
- [Quick Start](/getting-started/quick-start)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/deployment.md`

