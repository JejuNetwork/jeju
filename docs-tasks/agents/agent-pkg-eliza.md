# Agent Task: Eliza Plugin Documentation

## Scope
Research and document the Eliza Plugin package (`packages/eliza-plugin/`).

## Source Files to Analyze
- `packages/eliza-plugin/src/` - All source files
- `packages/eliza-plugin/test/` - Tests
- `packages/eliza-plugin/README.md` - Existing docs
- `packages/eliza-plugin/package.json` - Dependencies

## Research Questions
1. What is Eliza and how does this plugin integrate?
2. What actions does the plugin provide?
3. How does it connect to Jeju network?
4. What agent capabilities are enabled?
5. How do developers add this to their Eliza agents?
6. What wallet/signing integration exists?
7. What DeFi actions are available?
8. How does A2A work with Eliza?

## Output Format

### File: `apps/documentation/packages/eliza-plugin.md`

```markdown
# Eliza Plugin

[One-sentence description - Jeju integration for Eliza agents]

## Overview

[What Eliza is, what this plugin enables, use cases]

## Installation

\`\`\`bash
bun add @jejunetwork/eliza-plugin
\`\`\`

## Setup

\`\`\`typescript
import { JejuPlugin } from '@jejunetwork/eliza-plugin';

const plugin = new JejuPlugin({
  network: 'mainnet',
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Add to Eliza agent
agent.use(plugin);
\`\`\`

## Actions

### Token Actions
- `swap` - Swap tokens on Bazaar
- `transfer` - Transfer tokens
- `balance` - Check balances

### DeFi Actions
- `addLiquidity` - Add LP
- `stake` - Stake tokens

### Agent Actions
- `register` - Register agent identity
- `discover` - Find other agents

## Wallet Integration

[How the plugin manages keys and signs transactions]

## A2A Integration

[Agent-to-agent communication via Eliza]

## Examples

### Basic Trading Agent
\`\`\`typescript
// Full example of trading agent
\`\`\`

## Related

- [Agent Concepts](/learn/agents)
- [SDK](/packages/sdk)
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
`docs-tasks/research/eliza-plugin.md`

