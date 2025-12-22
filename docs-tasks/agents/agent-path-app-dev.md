# Agent Task: App Developer Path Documentation

## Scope
Create documentation path for developers building apps to deploy on Jeju network.

## Target Audience
- Developers building apps specifically for Jeju
- Want to leverage full Jeju ecosystem
- Building agents, DeFi protocols, marketplaces
- Need jeju-manifest.json integration

## User Journey
1. Understand Jeju app ecosystem
2. Set up development environment
3. Create app with jeju-manifest.json
4. Develop locally
5. Test with synpress
6. Deploy to testnet/mainnet

## Output Files

### 1. `apps/documentation/build/apps/overview.md`

```markdown
# Build Jeju Apps

Create applications that run natively in the Jeju ecosystem.

## What is a Jeju App?

Jeju apps are applications that:
- Have a `jeju-manifest.json` configuration
- Can auto-start with `bun run dev`
- Integrate with Jeju contracts and services
- Deploy via Jeju infrastructure

## Types of Apps

### Core Apps
Built-in apps like Gateway, Bazaar, Indexer.

### DApps
User-facing applications (frontends + contracts).

### Agents
Autonomous AI agents using ERC-8004 identity.

### Services
Backend services (APIs, bots, infrastructure).

## Quick Start

### 1. Create App Structure
\`\`\`bash
mkdir my-app && cd my-app
bun init
\`\`\`

### 2. Add Manifest
\`\`\`json
{
  "name": "my-app",
  "type": "dapp",
  "commands": {
    "dev": "bun run dev",
    "build": "bun run build"
  },
  "ports": {
    "main": 4100
  },
  "autoStart": false,
  "dependencies": {
    "contracts": ["TokenRegistry", "IdentityRegistry"]
  }
}
\`\`\`

### 3. Develop
\`\`\`bash
bun run dev
\`\`\`

### 4. Deploy
\`\`\`bash
jeju deploy my-app --network testnet
\`\`\`

## Manifest Schema

[Full manifest.json documentation]

## Example Apps

See `apps/example-app` for a complete example.

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/build/apps/manifest.md`

```markdown
# Jeju Manifest

Configure your app for the Jeju ecosystem.

## Location

Create `jeju-manifest.json` in your app's root directory.

## Schema

\`\`\`json
{
  "name": "string (required)",
  "type": "core | dapp | agent | service",
  "version": "string",
  "description": "string",
  "commands": {
    "dev": "string (required)",
    "build": "string",
    "test": "string",
    "deploy": "string"
  },
  "ports": {
    "main": "number (required)",
    "api": "number",
    "ws": "number"
  },
  "autoStart": "boolean",
  "dependencies": {
    "contracts": ["string"],
    "services": ["string"]
  },
  "env": {
    "required": ["string"],
    "optional": ["string"]
  }
}
\`\`\`

## Examples

### DApp
\`\`\`json
{
  "name": "my-dapp",
  "type": "dapp",
  "commands": { "dev": "next dev" },
  "ports": { "main": 3000 }
}
\`\`\`

### Agent
\`\`\`json
{
  "name": "trading-agent",
  "type": "agent",
  "commands": { "dev": "bun run agent.ts" },
  "ports": { "main": 4200, "a2a": 4201 }
}
\`\`\`

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/build/apps/agents.md`

```markdown
# Build Agents

Create autonomous AI agents on Jeju.

## What is a Jeju Agent?

Jeju agents are:
- Registered on-chain via ERC-8004
- Discoverable through IdentityRegistry
- Communicate via A2A protocol
- Can be called via MCP

## Quick Start

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'mainnet',
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Register agent
await client.identity.registerAgent({
  name: 'My Trading Agent',
  description: 'Automated trading strategies',
  endpoints: {
    a2a: 'https://my-agent.com/a2a',
    mcp: 'https://my-agent.com/mcp',
  },
});

// Start A2A server
const server = client.a2a.createServer({
  port: 4200,
  handlers: {
    analyze_market: async (params) => {
      // Your agent logic
      return { recommendation: 'buy' };
    },
  },
});

await server.start();
\`\`\`

## Agent Identity

[ERC-8004 registration, metadata]

## A2A Communication

[Agent-to-agent protocol]

## MCP Integration

[Model Context Protocol]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/path-app-dev.md`

