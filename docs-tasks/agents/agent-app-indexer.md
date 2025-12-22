# Agent Task: Indexer App Documentation

## Scope
Research and document the Indexer application (`apps/indexer/`).

## Source Files to Analyze
- `apps/indexer/src/` - All source files
- `apps/indexer/schema.graphql` - GraphQL schema
- `apps/indexer/squid.yaml` - Squid configuration
- `apps/indexer/README.md` - Existing docs
- `apps/indexer/package.json` - Dependencies

## Research Questions
1. What is the Indexer's primary purpose?
2. What blockchain data does it index?
3. What is the GraphQL schema structure?
4. How does event processing work?
5. What entities are tracked (tokens, users, transactions)?
6. How does it integrate with other apps?
7. What database does it use?
8. How do subscriptions work?

## Output Format

### File: `apps/documentation/apps/indexer.md`

```markdown
# Indexer

[One-sentence description - GraphQL API for indexed blockchain data]

## Overview

[2-3 paragraphs explaining purpose, what data is indexed, how apps use it]

## Features

### Event Indexing
[What events are tracked, processors]

### GraphQL API
[Schema overview, query types]

### Subscriptions
[Real-time data updates]

## Schema

### Key Entities
- Tokens
- Users  
- Transactions
- Swaps
- Liquidity positions
- Agent registrations

## Queries

### Example Queries
\`\`\`graphql
query GetTokens {
  tokens(first: 10) {
    id
    symbol
    name
    totalSupply
  }
}
\`\`\`

## Configuration

[Squid config, environment variables]

## Development

\`\`\`bash
cd apps/indexer
bun install
bun run dev
\`\`\`

## Related

- [GraphQL API Reference](/api-reference/graphql)
- [SDK Integration](/build/sdk/client)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/indexer.md`

