# Agent Task: Shared Package Documentation

## Scope
Research and document the Shared package (`packages/shared/`).

## Source Files to Analyze
- `packages/shared/src/` - All utilities
- `packages/shared/package.json` - Dependencies

## Research Questions
1. What utilities are provided?
2. What common patterns are implemented?
3. How do other packages use shared utilities?
4. What validation helpers exist?
5. What formatting utilities exist?
6. What error handling patterns are used?
7. What TypeScript helpers are provided?
8. What React components are shared?

## Output Format

### File: `apps/documentation/packages/shared.md`

```markdown
# Shared Package

[One-sentence description - common utilities and helpers]

## Overview

[Shared utilities used across Jeju packages]

## Installation

\`\`\`bash
bun add @jejunetwork/shared
\`\`\`

## Utilities

### Formatting
[Number formatting, address formatting, etc.]

### Validation
[Input validation, schema validation]

### Error Handling
[Error types, error formatting]

### Logging
[Logging utilities]

## React Components

[Shared React components]

## TypeScript Helpers

[Type utilities, guards]

## Usage Examples

\`\`\`typescript
import { formatAddress, validateAmount } from '@jejunetwork/shared';

const shortAddr = formatAddress('0x1234...5678');
const isValid = validateAmount('100', 18);
\`\`\`

## Related

- [Types Package](/packages/types)
- [SDK](/packages/sdk)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/shared.md`

