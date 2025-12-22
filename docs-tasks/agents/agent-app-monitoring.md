# Agent Task: Monitoring App Documentation

## Scope
Research and document the Monitoring application (`apps/monitoring/`).

## Source Files to Analyze
- `apps/monitoring/server/` - Backend
- `apps/monitoring/src/` - Frontend
- `apps/monitoring/grafana/` - Grafana dashboards
- `apps/monitoring/prometheus/` - Prometheus config
- `apps/monitoring/alertmanager/` - Alerting rules
- `apps/monitoring/README.md` - Existing docs

## Research Questions
1. What metrics are collected?
2. What dashboards are available?
3. How does alerting work?
4. What services are monitored?
5. How do operators use monitoring?
6. What health checks exist?
7. How does it integrate with infrastructure?
8. What storage backend is used?

## Output Format

### File: `apps/documentation/apps/monitoring.md`

```markdown
# Monitoring

[One-sentence description - infrastructure and service observability]

## Overview

[2-3 paragraphs about monitoring purpose, metrics, alerting]

## Features

### Metrics Collection
[Prometheus, exporters, custom metrics]

### Dashboards
[Grafana dashboards, visualization]

### Alerting
[AlertManager, notification channels]

### Health Checks
[Service health, uptime monitoring]

## Dashboards

### Network Dashboard
[Chain health, block production, transactions]

### Application Dashboard
[App metrics, request rates, errors]

### Node Dashboard
[Node health, resource utilization]

## Alerts

[Alert types, severity, escalation]

## Architecture

[Prometheus, Grafana, AlertManager stack]

## Configuration

[Prometheus targets, alerting rules]

## Development

\`\`\`bash
cd apps/monitoring
bun install
bun run dev
\`\`\`

## Related

- [Node Operation](/operate/overview)
- [Infrastructure](/deployment/infrastructure)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/monitoring.md`

