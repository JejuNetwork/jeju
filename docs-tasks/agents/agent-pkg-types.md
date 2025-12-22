# Agent Task: Types Package Documentation

## Scope
Research and document the Types package (`packages/types/`).

## Source Files to Analyze
- `packages/types/src/` - All type definitions
- `packages/types/package.json` - Dependencies

## Research Questions
1. What core types are defined?
2. How are chain types organized?
3. What contract types exist?
4. What API response types exist?
5. How do other packages use these types?
6. What validation schemas exist?
7. Are there runtime type checks?
8. How are types versioned?

## Output Format

### File: `apps/documentation/packages/types.md`

```markdown
# Types Package

[One-sentence description - shared TypeScript types]

## Overview

[Central type definitions for Jeju ecosystem]

## Installation

\`\`\`bash
bun add @jejunetwork/types
\`\`\`

## Core Types

### Chain Types
\`\`\`typescript
interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
}
\`\`\`

### Contract Types
\`\`\`typescript
interface ContractAddresses {
  tokenRegistry: Address;
  identityRegistry: Address;
  paymaster: Address;
  // ...
}
\`\`\`

### Transaction Types
[Transaction, UserOperation types]

### Agent Types
[Agent metadata, identity types]

## Usage

\`\`\`typescript
import type { 
  ChainConfig, 
  ContractAddresses, 
  Agent 
} from '@jejunetwork/types';
\`\`\`

## Related

- [Shared Package](/packages/shared)
- [Config Package](/packages/config)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/types.md`

