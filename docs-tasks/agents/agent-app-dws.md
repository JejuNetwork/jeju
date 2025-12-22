# Agent Task: DWS App Documentation

## Scope
Research and document the DWS (Decentralized Web Services) application (`apps/dws/`).

## Source Files to Analyze
- `apps/dws/src/` - All source files
- `apps/dws/frontend/` - Frontend code
- `apps/dws/README.md` - Existing docs
- `apps/dws/package.json` - Dependencies
- `apps/dws/jeju-manifest.json` - App configuration

## Research Questions
1. What is DWS's primary purpose?
2. What services does it provide (compute, storage, API)?
3. How does it replace traditional cloud services?
4. What is the pricing model?
5. How does node registration work?
6. What APIs does it expose?
7. How do developers integrate with DWS?
8. What is the service discovery mechanism?

## Output Format

### File: `apps/documentation/apps/dws.md`

```markdown
# DWS (Decentralized Web Services)

[One-sentence description - decentralized alternative to AWS/GCP/Azure]

## Overview

[2-3 paragraphs explaining DWS concept, what cloud services it replaces, 
value proposition for developers]

## Services

### Compute
[VM provisioning, container deployment, serverless]

### Storage
[IPFS, object storage, databases]

### CDN
[Content delivery, edge caching]

### Messaging
[Pub/sub, queues]

## Architecture

[Node network, service discovery, routing]

## Developer Integration

### SDK Usage
\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({ network: 'mainnet' });
const container = await client.dws.deploy({
  image: 'myapp:latest',
  ports: [3000],
});
\`\`\`

### API Endpoints
[REST/RPC endpoints for service management]

## Node Operators

[How to run DWS nodes, requirements, rewards]

## Pricing

[Service pricing, payment tokens, billing]

## Configuration

[Environment variables, config options]

## Development

\`\`\`bash
cd apps/dws
bun install
bun run dev
\`\`\`

## Related

- [SDK DWS Module](/build/sdk/dws)
- [Run Compute Node](/operate/compute-node)
- [Run Storage Node](/operate/storage-node)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/dws.md`

