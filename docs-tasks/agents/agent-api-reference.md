# Agent Task: API Reference Documentation

## Scope
Write comprehensive API reference documentation for all Jeju APIs.

## Source Files to Analyze
- `apps/gateway/src/` - REST, A2A, WebSocket APIs
- `apps/indexer/src/` - GraphQL API
- `apps/documentation/api-reference/` - Existing docs
- `packages/sdk/src/` - SDK APIs
- `apps/documentation/lib/` - A2A, x402 implementations

## Research Questions
1. What RPC endpoints are available?
2. What is the GraphQL schema?
3. How does A2A protocol work?
4. How does MCP integration work?
5. What is x402 and how is it used?
6. What WebSocket events are available?
7. What authentication is required?
8. What rate limits exist?

## Output Files

### 1. `apps/documentation/api-reference/rpc.md`

```markdown
# RPC API

Jeju JSON-RPC API reference.

## Endpoints

| Network | URL |
|---------|-----|
| Mainnet | https://rpc.jejunetwork.org |
| Testnet | https://testnet-rpc.jejunetwork.org |
| Localnet | http://127.0.0.1:9545 |

## Standard Methods

Jeju supports all standard Ethereum JSON-RPC methods.

### eth_chainId
\`\`\`bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  https://rpc.jejunetwork.org
\`\`\`

### eth_blockNumber
[Example]

### eth_getBalance
[Example]

### eth_sendRawTransaction
[Example]

## Extended Methods

### jeju_getFlashblockStatus
[Flashblock-specific methods]

### jeju_getPaymasterInfo
[Paymaster methods]

## Rate Limits

[Rate limiting details]

## SDKs

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';
const client = new JejuClient({ network: 'mainnet' });
\`\`\`

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/api-reference/graphql.md`

```markdown
# GraphQL API

Query indexed blockchain data via GraphQL.

## Endpoint

| Network | URL |
|---------|-----|
| Mainnet | https://indexer.jejunetwork.org/graphql |
| Testnet | https://testnet-indexer.jejunetwork.org/graphql |
| Localnet | http://127.0.0.1:4350/graphql |

## Schema

### Tokens
\`\`\`graphql
type Token {
  id: ID!
  symbol: String!
  name: String!
  decimals: Int!
  totalSupply: BigInt!
}

query GetTokens($first: Int!) {
  tokens(first: $first) {
    id
    symbol
    name
  }
}
\`\`\`

### Transactions
[Transaction schema]

### Swaps
[Swap schema]

### Agents
[Agent schema]

## Subscriptions

\`\`\`graphql
subscription OnNewSwap {
  swaps(orderBy: timestamp_DESC, first: 1) {
    id
    tokenIn { symbol }
    tokenOut { symbol }
    amountIn
    amountOut
  }
}
\`\`\`

## Pagination

[Cursor-based pagination]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/api-reference/a2a.md`

```markdown
# A2A Protocol

Agent-to-Agent communication protocol.

## Overview

A2A enables direct communication between on-chain registered agents.

## Endpoint Discovery

Agents register their A2A endpoint in the IdentityRegistry:

\`\`\`typescript
const agent = await client.identity.getAgent(agentAddress);
const a2aEndpoint = agent.metadata.a2a;
\`\`\`

## Request Format

\`\`\`json
{
  "jsonrpc": "2.0",
  "method": "a2a_task",
  "params": {
    "task": "analyze_market",
    "data": { "token": "0x..." }
  },
  "id": 1
}
\`\`\`

## Response Format

\`\`\`json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "completed",
    "data": { ... }
  },
  "id": 1
}
\`\`\`

## Authentication

[Signature-based authentication]

## Standard Methods

### a2a_capabilities
[Get agent capabilities]

### a2a_task
[Execute a task]

### a2a_status
[Check task status]

## SDK Usage

\`\`\`typescript
const response = await client.a2a.call({
  agent: targetAgentAddress,
  method: 'analyze_market',
  params: { token: tokenAddress },
});
\`\`\`

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 4. `apps/documentation/api-reference/mcp.md`

```markdown
# MCP Integration

Model Context Protocol integration for AI agents.

## Overview

MCP enables AI models to interact with Jeju through standardized tools.

## Available Tools

### blockchain_read
\`\`\`json
{
  "name": "blockchain_read",
  "description": "Read data from Jeju blockchain",
  "parameters": {
    "method": "eth_call",
    "to": "0x...",
    "data": "0x..."
  }
}
\`\`\`

### token_swap
[Swap tokens]

### agent_register
[Register agent]

## Server Setup

\`\`\`typescript
import { JejuMCPServer } from '@jejunetwork/sdk/mcp';

const server = new JejuMCPServer({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY,
});

server.start({ port: 3000 });
\`\`\`

## Client Usage

[How AI models connect to MCP server]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 5. `apps/documentation/api-reference/x402.md`

```markdown
# x402 Protocol

HTTP 402 Payment Required implementation for API monetization.

## Overview

x402 enables pay-per-request APIs using Jeju payments.

## Flow

1. Client requests protected resource
2. Server returns 402 with payment details
3. Client makes payment
4. Client retries with payment proof
5. Server returns resource

## Response Format

\`\`\`
HTTP/1.1 402 Payment Required
X-Payment-Required: true
X-Payment-Amount: 1000000
X-Payment-Token: 0x...
X-Payment-Recipient: 0x...
\`\`\`

## SDK Usage

### Server
\`\`\`typescript
import { x402Middleware } from '@jejunetwork/sdk/x402';

app.use('/api/premium', x402Middleware({
  amount: parseUnits('0.01', 6),
  token: USDC_ADDRESS,
}));
\`\`\`

### Client
\`\`\`typescript
import { x402Client } from '@jejunetwork/sdk/x402';

const client = new x402Client({ privateKey });
const response = await client.fetch('https://api.example.com/premium/data');
\`\`\`

## Use Cases

[API monetization examples]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/api-reference.md`

