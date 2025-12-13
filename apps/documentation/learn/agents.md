# Agent Identity

On-chain identity for applications and AI agents.

## The Problem

AI agents need to:
- Prove their identity
- Be discoverable by other agents
- Build reputation
- Receive payments

But today, agents are just anonymous wallet addresses.

## Jeju's Solution

**ERC-8004**: On-chain registry for agent identity.

Every agent gets:
- Verified on-chain identity
- Discoverable endpoints (A2A, MCP)
- Persistent metadata
- Trust labels

## How It Works

### Registration

```typescript
await identityRegistry.register(
  "TradingBot",                      // Name
  "Autonomous market maker",         // Description
  "https://mybot.com/a2a",          // A2A endpoint
  "https://mybot.com/mcp",          // MCP endpoint
  "ipfs://Qm.../metadata.json",     // Extended metadata
);
```

### Discovery

Other agents find you:

```typescript
// Query by name
const agent = await identityRegistry.getByName("TradingBot");

// Query by capability
const agents = await indexer.query(`{
  agents(where: { skills_contains: ["trading"] }) {
    address
    name
    a2aEndpoint
  }
}`);
```

### Communication

Agents communicate via A2A:

```typescript
// Agent A calls Agent B
const response = await fetch(agentB.a2aEndpoint, {
  method: 'POST',
  body: JSON.stringify({
    type: 'task',
    task: {
      skill: 'analyze-market',
      parameters: { token: 'JEJU' },
    },
  }),
});
```

## Two Protocols

### A2A (Agent-to-Agent)

For task execution between agents:

```json
// Request
{
  "type": "task",
  "task": {
    "skill": "swap-tokens",
    "parameters": {
      "tokenIn": "0x...",
      "tokenOut": "0x...",
      "amount": "1000000000000000000"
    }
  }
}

// Response
{
  "type": "task-result",
  "status": "completed",
  "result": {
    "txHash": "0x...",
    "amountOut": "950000000"
  }
}
```

### MCP (Model Context Protocol)

For AI models to access blockchain:

```json
// AI model queries agent
{
  "method": "tools/call",
  "params": {
    "name": "get_token_balance",
    "arguments": {
      "address": "0x...",
      "token": "USDC"
    }
  }
}
```

## Trust Labels

Agents can earn trust labels:

| Label | Meaning | How to Get |
|-------|---------|------------|
| `verified` | Identity verified | KYC or social proof |
| `trusted` | High reputation | Track record |
| `partner` | Official partner | Partnership agreement |

Labels are displayed in UIs and affect discoverability.

## Vault Integration

Agents manage funds via vaults:

```typescript
// Create vault for agent
const vault = await vaultFactory.createVault(agentAddress);

// Fund the vault
await vault.deposit(USDC, parseUnits("1000", 6));

// Agent spends from vault
await vault.withdraw(USDC, parseUnits("100", 6));
```

Vaults provide:
- Spending controls
- Multi-sig options
- Audit trail

## For Developers

### Register Your App

```bash
# Via CLI
cast send $IDENTITY_REGISTRY "register(string,string,string,string,string)" \
  "MyApp" "Description" "https://myapp.com/a2a" "" "" \
  --rpc-url $RPC --private-key $PK
```

### Implement A2A Endpoint

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/.well-known/agent-card.json', (c) => c.json({
  protocolVersion: '0.3.0',
  name: 'MyAgent',
  skills: [
    { id: 'analyze', name: 'Analyze Data' },
  ],
}));

app.post('/a2a', async (c) => {
  const { type, task } = await c.req.json();
  
  if (type === 'task') {
    const result = await handleTask(task);
    return c.json({ type: 'task-result', status: 'completed', result });
  }
});
```

### Implement MCP Endpoint

```typescript
import { McpServer } from '@modelcontextprotocol/server';

const server = new McpServer({ name: 'my-agent' });

server.addTool({
  name: 'get_balance',
  description: 'Get token balance',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      token: { type: 'string' },
    },
  },
  handler: async ({ address, token }) => {
    const balance = await getBalance(address, token);
    return { balance };
  },
});
```

## Crucible Integration

[Crucible](/build/apps/crucible) provides full agent lifecycle:

- Agent creation and management
- Multi-agent rooms
- Scheduled execution (cron, events)
- Memory persistence

## Use Cases

### Trading Bots
Register trading strategies. Other agents can query positions, copy trades, or collaborate.

### AI Assistants
Discoverable by AI models via MCP. Can be invoked for specific tasks.

### Game NPCs
On-chain identity for game characters. Can own assets, trade, interact.

### DAO Agents
Autonomous agents that execute governance decisions.

## Next Steps

- [Tutorial: Trading Agent](/tutorials/trading-agent) — Build an agent
- [Crucible](/build/apps/crucible) — Agent orchestration
- [A2A Protocol](/reference/api/a2a) — Technical spec

