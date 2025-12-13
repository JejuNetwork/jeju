# MCP (Model Context Protocol)

MCP integration for AI model access to Jeju services.

## Overview

MCP allows AI models (Claude, GPT, etc.) to:
- Read blockchain data
- Execute transactions
- Interact with Jeju apps
- Access agent capabilities

## Endpoints

Every Jeju app exposes MCP at `/mcp`. Gateway is available at http://localhost:4003/mcp, Indexer at http://localhost:4350/mcp, Compute at http://localhost:4007/mcp, and Storage at http://localhost:4010/mcp.

## Server Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "jeju-gateway": {
      "url": "https://gateway.jeju.network/mcp",
      "transport": "http"
    },
    "jeju-indexer": {
      "url": "https://indexer.jeju.network/mcp",
      "transport": "http"
    }
  }
}
```

## Available Tools

### Gateway Tools

Gateway exposes `bridge_tokens` to bridge tokens between chains, `get_bridge_status` to check bridge transaction status, `stake_tokens` to stake tokens for rewards, `get_stake_info` to retrieve staking information, and `register_token` to register tokens for the paymaster.

### Indexer Tools

Indexer provides `get_block` to fetch blocks by number or hash, `get_transaction` for transaction details, `get_token_balance` for token balances, `query_events` to query contract events, and `search_agents` to search registered agents.

### Compute Tools

Compute offers `list_providers` to list compute providers, `run_inference` to run AI inference, `create_rental` to create compute rentals, and `get_session_status` to check rental session status.

### Storage Tools

Storage includes `upload_file` to upload files to IPFS, `get_file` to retrieve files by CID, `pin_content` to pin content for persistence, and `list_pins` to list all pinned content.

## Tool Schemas

### bridge_tokens

```json
{
  "name": "bridge_tokens",
  "description": "Bridge tokens from source chain to Jeju",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sourceChain": {
        "type": "number",
        "description": "Source chain ID"
      },
      "token": {
        "type": "string",
        "description": "Token address"
      },
      "amount": {
        "type": "string",
        "description": "Amount in wei"
      },
      "recipient": {
        "type": "string",
        "description": "Recipient address on Jeju"
      }
    },
    "required": ["sourceChain", "token", "amount"]
  }
}
```

### run_inference

```json
{
  "name": "run_inference",
  "description": "Run AI inference on compute marketplace",
  "inputSchema": {
    "type": "object",
    "properties": {
      "model": {
        "type": "string",
        "description": "Model name (e.g., llama2, mixtral)"
      },
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "role": {"type": "string"},
            "content": {"type": "string"}
          }
        }
      },
      "maxTokens": {
        "type": "number",
        "description": "Maximum tokens to generate"
      }
    },
    "required": ["model", "messages"]
  }
}
```

## Resources

MCP resources for read-only data:

### Gateway Resources

Gateway resources include network info at `jeju://network/info`, token list at `jeju://tokens/list`, and staking pools at `jeju://staking/pools`.

### Indexer Resources

Indexer resources include latest block at `jeju://blocks/latest`, block by number at `jeju://blocks/{number}`, transaction at `jeju://tx/{hash}`, and address info at `jeju://address/{address}`.

## Prompts

Pre-defined prompts for common tasks:

### check_balance

```json
{
  "name": "check_balance",
  "description": "Check token balance for an address",
  "arguments": [
    {
      "name": "address",
      "description": "Ethereum address",
      "required": true
    },
    {
      "name": "token",
      "description": "Token symbol or address",
      "required": false
    }
  ]
}
```

## Implementation

### Adding MCP to Your App

```typescript
import { McpServer } from '@modelcontextprotocol/server';

const server = new McpServer({
  name: 'my-jeju-app',
  version: '1.0.0',
});

// Add tools
server.addTool({
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: {
      param: { type: 'string' },
    },
  },
  handler: async (params) => {
    // Tool implementation
    return { result: 'success' };
  },
});

// Add resources
server.addResource({
  uri: 'myapp://data/info',
  name: 'App Info',
  description: 'Get app information',
  handler: async () => {
    return { version: '1.0.0', status: 'running' };
  },
});

// Start server
server.listen(4099);
```

### Exposing via HTTP

```typescript
import { Hono } from 'hono';
import { McpHttpAdapter } from '@modelcontextprotocol/http-adapter';

const app = new Hono();
const mcp = new McpHttpAdapter(server);

app.post('/mcp', async (c) => {
  const body = await c.req.json();
  const result = await mcp.handleRequest(body);
  return c.json(result);
});
```

## Authentication

### Wallet Signature

```json
{
  "method": "tools/call",
  "params": {
    "name": "stake_tokens",
    "arguments": { ... }
  },
  "auth": {
    "type": "signature",
    "address": "0x...",
    "signature": "0x...",
    "message": "MCP request at 1234567890"
  }
}
```

### API Key

```json
{
  "method": "tools/call",
  "params": { ... },
  "auth": {
    "type": "api-key",
    "key": "your-api-key"
  }
}
```

## Error Handling

```json
{
  "error": {
    "code": -32602,
    "message": "Invalid parameters",
    "data": {
      "details": "Missing required field: amount"
    }
  }
}
```

Error codes follow JSON-RPC conventions: -32600 for invalid request, -32601 for method not found, -32602 for invalid params, -32603 for internal error, -32001 for unauthorized, and -32002 for payment required.

