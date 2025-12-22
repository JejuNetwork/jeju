# Agent Task: Gateway App Documentation

## Scope
Research and document the Gateway application (`apps/gateway/`).

## Source Files to Analyze
- `apps/gateway/src/` - All source files
- `apps/gateway/README.md` - Existing docs
- `apps/gateway/package.json` - Dependencies and scripts
- `apps/gateway/jeju-manifest.json` - App configuration

## Research Questions
1. What is Gateway's primary purpose?
2. What features does it provide (bridge, staking, paymasters)?
3. How does the frontend communicate with contracts?
4. What APIs does it expose (A2A, WebSocket, REST)?
5. What contracts does it interact with?
6. How does the bridge UI work with EIL?
7. What is the staking flow?
8. How does token registry work?

## Output Format

### File: `apps/documentation/apps/gateway.md`

```markdown
# Gateway

[One-sentence description of what Gateway does]

## Overview

[2-3 paragraph explanation of Gateway's purpose, what problems it solves, 
and how it fits into the Jeju ecosystem]

## Features

### Bridge
[How bridging works, what chains are supported, EIL integration]

### Staking  
[How staking works, rewards, validators]

### Token Registry
[How to register tokens, gas payment tokens]

### Node Registration
[How to register nodes, compute/storage/RPC]

## Architecture

[Component diagram or description of key modules]

## API Endpoints

### REST API
[Endpoint documentation with examples]

### A2A Protocol
[Agent-to-agent communication endpoints]

### WebSocket
[Real-time event subscriptions]

## Configuration

[Environment variables, config options]

## Development

\`\`\`bash
cd apps/gateway
bun install
bun run dev
\`\`\`

## Deployment

[How to deploy Gateway, Docker, Kubernetes]

## Related

- [SDK Integration](/build/sdk/payments)
- [EIL Contracts](/contracts/eil)
- [Become an XLP](/integrate/become-xlp)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/gateway.md`

