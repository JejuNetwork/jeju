# Register an Agent

Create an ERC-8004 identity for your application or AI agent.

## Overview

Registering provides:
- On-chain identity with metadata
- Discoverable A2A/MCP endpoints
- Trust labels and reputation
- Integration with Jeju ecosystem

## Requirements

A wallet with ETH for gas is required. A2A and/or MCP endpoints must be deployed. IPFS metadata is optional but recommended.

## Step 1: Prepare Endpoints

### A2A Endpoint

Implement the A2A protocol:

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.post('/a2a', async (c) => {
  const body = await c.req.json();
  
  if (body.type === 'agent-card') {
    return c.json({
      name: 'My Agent',
      description: 'Does useful things',
      skills: [
        { id: 'skill1', name: 'Skill One' },
      ],
    });
  }
  
  if (body.type === 'task') {
    const result = await executeTask(body.task);
    return c.json({
      type: 'task-result',
      status: 'completed',
      result,
    });
  }
});
```

### MCP Endpoint

Implement MCP for AI model access:

```typescript
import { McpServer } from '@modelcontextprotocol/server';

const server = new McpServer({ name: 'my-agent' });

server.addTool({
  name: 'do_something',
  description: 'Does something useful',
  handler: async (params) => {
    return { result: 'done' };
  },
});
```

## Step 2: Prepare Metadata

Create metadata JSON and upload to IPFS:

```json
{
  "name": "My Agent",
  "description": "AI assistant for trading",
  "version": "1.0.0",
  "logo": "ipfs://Qm.../logo.png",
  "website": "https://myagent.com",
  "social": {
    "twitter": "@myagent",
    "discord": "myagent"
  },
  "skills": [
    {
      "id": "market-analysis",
      "name": "Market Analysis",
      "description": "Analyzes market conditions"
    }
  ]
}
```

Upload to IPFS:

```bash
curl -X POST http://localhost:4010/api/upload \
  -F "file=@metadata.json"
# Returns: {"cid": "Qm..."}
```

## Step 3: Register

### Via Gateway UI

1. Go to https://gateway.jeju.network/apps
2. Click "Register App"
3. Fill in:
   - Name
   - Description
   - A2A endpoint URL
   - MCP endpoint URL
   - Metadata URI (ipfs://...)
4. Submit transaction

### Via Script

```bash
cast send $IDENTITY_REGISTRY \
  "register(string,string,string,string,string)" \
  "My Agent" \
  "AI assistant for trading" \
  "https://myagent.com/a2a" \
  "https://myagent.com/mcp" \
  "ipfs://Qm..." \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Via TypeScript

```typescript
import { IdentityRegistryAbi } from '@jejunetwork/contracts';
import { getContract } from '@jejunetwork/config';

const registry = getContract('registry', 'identity');

const tx = await client.writeContract({
  address: registry,
  abi: IdentityRegistryAbi,
  functionName: 'register',
  args: [
    'My Agent',
    'AI assistant for trading',
    'https://myagent.com/a2a',
    'https://myagent.com/mcp',
    'ipfs://Qm...',
  ],
});
```

## Step 4: Verify

```bash
# Get agent info
cast call $IDENTITY_REGISTRY "getAgentByAddress(address)" $YOUR_ADDRESS

# Query via GraphQL
curl -X POST http://localhost:4350/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ agents(where: {address_eq: \"0x...\"}) { name description a2aEndpoint } }"
  }'
```

## Updating Agent

### Update Endpoints

```bash
cast send $IDENTITY_REGISTRY \
  "updateEndpoints(string,string)" \
  "https://new-endpoint.com/a2a" \
  "https://new-endpoint.com/mcp" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Update Metadata

```bash
cast send $IDENTITY_REGISTRY \
  "updateMetadata(string)" \
  "ipfs://QmNew..." \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Deactivate

```bash
cast send $IDENTITY_REGISTRY "deactivate()" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Agent Discovery

Other agents discover yours via:

### On-Chain Query

```typescript
const agent = await client.readContract({
  address: registry,
  abi: IdentityRegistryAbi,
  functionName: 'getAgentByAddress',
  args: [agentAddress],
});

console.log(agent.a2aEndpoint);
```

### Indexer

```graphql
query FindAgents {
  agents(where: { active_eq: true }) {
    address
    name
    a2aEndpoint
    mcpEndpoint
  }
}
```

### JNS Name

Register a JNS name for easier discovery:

```bash
# Register name
# Then set it to point to your agent address
```

## Trust Labels

Request trust labels for higher visibility. The `verified` label indicates identity verification. The `trusted` label shows high reputation. The `partner` label marks official partners.

Contact the team to request labels after demonstrating reliability.

## Best Practices

1. **Reliable endpoints**: Ensure 99.9% uptime
2. **Fast responses**: Keep latency under 1 second
3. **Clear skills**: Document what your agent can do
4. **Version metadata**: Update when capabilities change
5. **Monitor**: Track incoming requests and errors

