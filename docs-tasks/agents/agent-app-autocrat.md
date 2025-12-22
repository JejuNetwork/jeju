# Agent Task: Autocrat App Documentation

## Scope
Research and document the Autocrat application (`apps/autocrat/`).

## Source Files to Analyze
- `apps/autocrat/src/` - Backend source
- `apps/autocrat/app/` - Frontend app
- `apps/autocrat/scripts/` - Utility scripts
- `apps/autocrat/README.md` - Existing docs
- `apps/autocrat/package.json` - Dependencies

## Research Questions
1. What is Autocrat's primary purpose?
2. How does it relate to governance?
3. What automated governance features does it provide?
4. How do proposals work?
5. What voting mechanisms are supported?
6. How does it integrate with DAO contracts?
7. What is the delegation system?
8. How are governance actions executed?

## Output Format

### File: `apps/documentation/apps/autocrat.md`

```markdown
# Autocrat

[One-sentence description - automated governance platform]

## Overview

[2-3 paragraphs explaining Autocrat, governance automation, use cases]

## Features

### Proposal Management
[Creating, viewing, voting on proposals]

### Voting
[Vote types, quorum, delegation]

### Execution
[Timelock, automatic execution]

### Delegation
[Vote delegation, representatives]

## Architecture

[Governance flow, contract integration]

## User Flows

### Create Proposal Flow
[Step-by-step proposal creation]

### Voting Flow
[How to vote, delegation]

## Configuration

[Environment variables]

## Development

\`\`\`bash
cd apps/autocrat
bun install
bun run dev
\`\`\`

## Related

- [Governance Contracts](/contracts/governance)
- [SDK Governance](/build/sdk/governance)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/autocrat.md`

