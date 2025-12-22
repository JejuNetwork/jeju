# Agent Task: Factory App Documentation

## Scope
Research and document the Factory application (`apps/factory/`).

## Source Files to Analyze
- `apps/factory/app/` - Next.js app routes
- `apps/factory/components/` - UI components
- `apps/factory/lib/` - Core logic
- `apps/factory/types/` - Type definitions
- `apps/factory/package.json` - Dependencies

## Research Questions
1. What is Factory's primary purpose?
2. What can users create/deploy through Factory?
3. How does token creation work?
4. How does contract deployment work?
5. What templates are available?
6. How does it integrate with Jeju contracts?
7. What is the governance/DAO creation flow?
8. What fees are involved?

## Output Format

### File: `apps/documentation/apps/factory.md`

```markdown
# Factory

[One-sentence description - no-code token/contract deployment]

## Overview

[2-3 paragraphs explaining Factory purpose, what can be created]

## Features

### Token Creation
[ERC-20 creation, custom parameters, bonding curves]

### Contract Deployment
[Template-based contract deployment]

### DAO Creation
[Governance setup, voting, treasury]

### NFT Collections
[NFT contract deployment]

## Templates

[Available contract templates]

## User Flows

### Create Token Flow
[Step-by-step token creation]

### Deploy Contract Flow
[Step-by-step contract deployment]

## Fees

[Gas costs, protocol fees]

## Configuration

[Environment variables]

## Development

\`\`\`bash
cd apps/factory
bun install
bun run dev
\`\`\`

## Related

- [Token Contracts](/contracts/tokens)
- [SDK Token Module](/build/sdk/token)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/factory.md`

