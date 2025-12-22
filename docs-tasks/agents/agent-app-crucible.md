# Agent Task: Crucible App Documentation

## Scope
Research and document the Crucible application (`apps/crucible/`).

## Source Files to Analyze
- `apps/crucible/src/` - All source files
- `apps/crucible/README.md` - Existing docs
- `apps/crucible/package.json` - Dependencies
- `apps/crucible/jeju-manifest.json` - App configuration

## Research Questions
1. What is Crucible's primary purpose (agent orchestration)?
2. How does it manage AI agents?
3. What is the agent lifecycle?
4. How does it integrate with ERC-8004 identity?
5. How does agent discovery work?
6. What APIs does it expose?
7. How do agents communicate (A2A, MCP)?
8. What compute resources does it manage?

## Output Format

### File: `apps/documentation/apps/crucible.md`

```markdown
# Crucible

[One-sentence description - agent orchestration platform]

## Overview

[2-3 paragraphs explaining agent management, orchestration, lifecycle]

## Features

### Agent Registry
[How agents register, metadata, discovery]

### Agent Lifecycle
[Creation, deployment, monitoring, termination]

### Resource Management
[Compute allocation, scaling]

### Communication
[A2A protocol, MCP integration, inter-agent messaging]

## Architecture

[Key modules, agent runtime, state management]

## Agent Types

[Different agent categories supported]

## API Endpoints

[Agent management APIs]

## Configuration

[Environment variables, config options]

## Development

\`\`\`bash
cd apps/crucible
bun install
bun run dev
\`\`\`

## Related

- [Agent Concepts](/learn/agents)
- [ERC-8004 Identity](/contracts/identity)
- [A2A Protocol](/api-reference/a2a)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/crucible.md`

