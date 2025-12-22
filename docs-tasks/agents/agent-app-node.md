# Agent Task: Node App Documentation

## Scope
Research and document the Node application (`apps/node/`).

## Source Files to Analyze
- `apps/node/` - All source files (Rust and TypeScript)
- `apps/node/package.json` - Dependencies

## Research Questions
1. What type of node is this (RPC, compute, storage)?
2. What Rust components are included?
3. What TypeScript components are included?
4. How does node registration work?
5. What services does a node provide?
6. How does staking work for nodes?
7. What are the hardware requirements?
8. How does the node communicate with the network?

## Output Format

### File: `apps/documentation/apps/node.md`

```markdown
# Node

[One-sentence description - full node implementation]

## Overview

[2-3 paragraphs about node purpose, what services it provides]

## Components

### Rust Components
[Core node functionality in Rust]

### TypeScript Components
[Management, APIs, integrations]

## Node Types

### RPC Node
[Serving RPC requests]

### Compute Node
[AI inference, containers]

### Storage Node
[IPFS, pinning]

## Requirements

### Hardware
[CPU, RAM, storage, network]

### Software
[Dependencies, OS support]

## Setup

[Step-by-step node setup]

## Registration

[How to register node on-chain]

## Staking

[Staking requirements, rewards]

## Configuration

[Node configuration options]

## Development

\`\`\`bash
cd apps/node
bun install
bun run dev
\`\`\`

## Related

- [Run RPC Node](/operate/rpc-node)
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
`docs-tasks/research/node.md`

