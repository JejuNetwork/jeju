# Agent Task: Config Package Documentation

## Scope
Research and document the Config package (`packages/config/`).

## Source Files to Analyze
- `packages/config/` - All config files
- `packages/config/index.ts` - Main exports
- `packages/config/chains.json` - Chain definitions
- `packages/config/contracts.json` - Contract addresses
- `packages/config/tokens.json` - Token registry
- `packages/config/branding.json` - Network branding

## Research Questions
1. What configuration types are available?
2. How do networks define their config?
3. How are contract addresses organized?
4. How does branding customization work?
5. What schema validation exists?
6. How do developers consume config?
7. What environment variables are used?
8. How do forks inherit/override config?

## Output Format

### File: `apps/documentation/packages/config.md`

```markdown
# Config Package

[One-sentence description - centralized network configuration]

## Overview

[Configuration management, network definitions, addresses]

## Installation

\`\`\`bash
bun add @jejunetwork/config
\`\`\`

## Usage

\`\`\`typescript
import { getChainConfig, getContractAddresses } from '@jejunetwork/config';

const chain = getChainConfig('mainnet');
const addresses = getContractAddresses(420691);
\`\`\`

## Configuration Files

### chains.json
[Chain definitions, RPC endpoints, explorer URLs]

### contracts.json
[Deployed contract addresses per network]

### tokens.json
[Registered tokens, decimals, addresses]

### branding.json
[Network branding, colors, logos]

## Schema

[TypeScript types for configuration]

## Customization

[How to override config for forks]

## Related

- [Networks](/getting-started/networks)
- [Environment Variables](/reference/env-vars)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/config.md`

