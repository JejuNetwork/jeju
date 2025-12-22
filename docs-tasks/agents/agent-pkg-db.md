# Agent Task: DB Package Documentation

## Scope
Research and document the DB package (`packages/db/`).

## Source Files to Analyze
- `packages/db/src/` - All source files
- `packages/db/package.json` - Dependencies

## Research Questions
1. What database abstraction is provided?
2. What databases are supported?
3. How is CQL (Cassandra) used?
4. What schema migrations exist?
5. How do apps use the DB package?
6. What caching is implemented?
7. How is connection pooling handled?
8. What query patterns are used?

## Output Format

### File: `apps/documentation/packages/db.md`

```markdown
# DB Package

[One-sentence description - database abstraction layer]

## Overview

[Database connectivity, supported backends, use cases]

## Supported Databases

- ScyllaDB/Cassandra (CQL)
- PostgreSQL
- SQLite (development)

## Usage

\`\`\`typescript
import { createDbClient } from '@jejunetwork/db';

const db = createDbClient({
  type: 'scylla',
  hosts: ['localhost:9042'],
  keyspace: 'jeju',
});

const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
\`\`\`

## Schemas

[Database schema definitions]

## Migrations

[How to run migrations]

## Connection Management

[Connection pooling, failover]

## Caching

[Query caching, TTL]

## Related

- [Indexer](/apps/indexer)
- [Infrastructure](/deployment/infrastructure)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/db.md`

