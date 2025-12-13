# A2A Protocol

Agent-to-Agent protocol for autonomous agent communication.

## Overview

A2A enables agents to discover other agents via IdentityRegistry, send tasks and receive results, chain operations across multiple agents, and handle authentication and payments.

## Endpoints

Every Jeju app exposes A2A. Gateway uses port 4003, Indexer uses port 4350, Compute uses port 4007, and Storage uses port 4010. Production endpoints use HTTPS.

## Agent Discovery

### Via IdentityRegistry

```typescript
import { getContract } from '@jejunetwork/config';
import { IdentityRegistryAbi } from '@jejunetwork/contracts';

const registry = getContract('registry', 'identity');

const agent = await client.readContract({
  address: registry,
  abi: IdentityRegistryAbi,
  functionName: 'getAgentByAddress',
  args: [agentAddress],
});

const response = await fetch(agent.a2aEndpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'agent-card' }),
});
```

### Agent Card

Request an agent's capabilities by sending `{"type": "agent-card"}`. The response includes name, description, version, skills (with id, name, description, and parameters), and endpoints (a2a and mcp URLs).

## Sending Tasks

### Task Request

```json
{
  "type": "task",
  "task": {
    "id": "task-123",
    "skill": "bridge",
    "parameters": {
      "sourceChain": 1,
      "destinationChain": 420691,
      "token": "0x...",
      "amount": "1000000000000000000"
    }
  },
  "auth": {
    "type": "signature",
    "address": "0x...",
    "signature": "0x..."
  }
}
```

### Task Response

```json
{
  "type": "task-result",
  "taskId": "task-123",
  "status": "completed",
  "result": {
    "txHash": "0x...",
    "bridgeId": "bridge-456"
  }
}
```

### Async Tasks

For long-running tasks, the response includes a statusUrl to poll for completion.

## Authentication

### Signature Auth

Sign a message with your wallet containing the task, timestamp, and nonce. Include the signature in the `auth` field.

### API Key Auth

For registered applications, include the `X-API-Key` header.

### x402 Payment

For paid endpoints, the first request returns 402 with payment requirements. Pay and retry with the `X-Payment` header.

## Message Types

**agent-card**: Get agent capabilities. **task**: Execute a skill with parameters. **task-result**: Skill execution result with status (completed, failed, pending). **event**: Notify of an event.

## WebSocket

For real-time communication, connect to the `/a2a/ws` endpoint and subscribe to events.

## Error Handling

Error responses include type "error", a code, message, and optional details. Error codes include INVALID_REQUEST, INVALID_PARAMETERS, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, PAYMENT_REQUIRED, RATE_LIMITED, and INTERNAL_ERROR.

## Building an A2A Agent

### Server (Hono)

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.post('/a2a', async (c) => {
  const body = await c.req.json();
  
  if (body.type === 'agent-card') {
    return c.json({
      name: 'My Agent',
      skills: [{ id: 'greet', name: 'Greet' }],
    });
  }
  
  if (body.type === 'task') {
    const { skill, parameters } = body.task;
    
    if (skill === 'greet') {
      return c.json({
        type: 'task-result',
        taskId: body.task.id,
        status: 'completed',
        result: { message: `Hello, ${parameters.name}!` },
      });
    }
  }
  
  return c.json({ type: 'error', code: 'NOT_FOUND' }, 404);
});
```

### Client

```typescript
async function callAgent(endpoint, skill, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'task',
      task: { skill, parameters: params },
    }),
  });
  return response.json();
}

const result = await callAgent(
  'https://myagent.jeju.network/a2a',
  'greet',
  { name: 'Alice' }
);
```
