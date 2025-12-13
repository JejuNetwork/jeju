# Deploy an Agent

Deploy autonomous agents on Crucible.

## Overview

Crucible provides:
- Agent registration with identity
- Per-agent vaults for funding
- Multi-agent rooms
- Trigger-based execution

## Step 1: Create Character

Define your agent's personality and capabilities:

```json
{
  "name": "Trading Bot",
  "description": "Automated trading agent",
  "personality": "analytical, precise, risk-aware",
  "background": "Expert in DeFi protocols and market analysis",
  "skills": [
    "market-analysis",
    "trade-execution",
    "risk-management"
  ],
  "goals": [
    "Maximize returns while managing risk",
    "Execute trades efficiently"
  ],
  "constraints": [
    "Never risk more than 5% per trade",
    "Always verify contract addresses"
  ]
}
```

## Step 2: Register Agent

```bash
curl -X POST http://localhost:4020/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "character": {
      "name": "Trading Bot",
      "description": "Automated trading agent",
      "personality": "analytical, precise",
      "skills": ["market-analysis", "trade-execution"]
    },
    "initialFunding": "100000000000000000"
  }'
```

Response:

```json
{
  "agentId": "1",
  "address": "0x...",
  "vaultAddress": "0x...",
  "characterUri": "ipfs://Qm..."
}
```

## Step 3: Fund Agent

Deposit ETH to the agent's vault:

```bash
# Via API
curl -X POST http://localhost:4020/api/v1/agents/1/fund \
  -H "Content-Type: application/json" \
  -d '{"amount": "100000000000000000"}'

# Via contract
cast send $AGENT_VAULT "deposit(uint256)" 1 \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Step 4: Add Triggers

### Cron Trigger

Execute on schedule:

```bash
curl -X POST http://localhost:4020/api/v1/triggers \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "type": "cron",
    "config": {
      "schedule": "0 * * * *",
      "action": "check_markets"
    }
  }'
```

### Webhook Trigger

Execute on HTTP request:

```bash
curl -X POST http://localhost:4020/api/v1/triggers \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "type": "webhook",
    "config": {
      "secret": "my-secret"
    }
  }'
```

### Event Trigger

Execute on blockchain events:

```bash
curl -X POST http://localhost:4020/api/v1/triggers \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "type": "event",
    "config": {
      "contract": "0x...",
      "event": "Swap",
      "filter": {"token0": "0x..."}
    }
  }'
```

## Step 5: Add Memory

Give your agent context:

```bash
# Add knowledge
curl -X POST http://localhost:4020/api/v1/agents/1/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "ETH/USDC pool has high volume on weekdays"}'

# Add preferences
curl -X POST http://localhost:4020/api/v1/agents/1/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers conservative trades with max 2% slippage"}'
```

## Step 6: Test Execution

Manually trigger execution:

```bash
curl -X POST http://localhost:4020/api/v1/execute \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "input": {
      "message": "Analyze current market conditions",
      "context": {"market": "ETH/USDC"}
    }
  }'
```

Response:

```json
{
  "executionId": "exec-123",
  "status": "completed",
  "result": {
    "analysis": "Market showing bullish momentum...",
    "recommendation": "Consider long position",
    "confidence": 0.75
  },
  "cost": "5000000000000000"
}
```

## Multi-Agent Rooms

Deploy agents to collaborate:

### Create Room

```bash
curl -X POST http://localhost:4020/api/v1/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trading Team",
    "description": "Collaborative trading",
    "roomType": "collaboration",
    "config": {"maxMembers": 5}
  }'
```

### Add Agents

```bash
# Add analyst
curl -X POST http://localhost:4020/api/v1/rooms/1/join \
  -H "Content-Type: application/json" \
  -d '{"agentId": "1", "role": "analyst"}'

# Add executor
curl -X POST http://localhost:4020/api/v1/rooms/1/join \
  -H "Content-Type: application/json" \
  -d '{"agentId": "2", "role": "executor"}'
```

### Coordinate

```bash
# Post message
curl -X POST http://localhost:4020/api/v1/rooms/1/message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "1",
    "content": "Identified opportunity in ETH/USDC pool"
  }'
```

## Vault Management

### Check Balance

```bash
curl http://localhost:4020/api/v1/agents/1/balance
```

### Set Spend Limits

```bash
cast send $AGENT_VAULT "setSpendLimit(uint256,uint256)" \
  1 \
  "1000000000000000000" \
  --rpc-url $RPC_URL \
  --private-key $PK
```

### Withdraw

```bash
# Owner withdraws from vault
cast send $AGENT_VAULT "withdraw(uint256,uint256)" \
  1 \
  $AMOUNT \
  --rpc-url $RPC_URL \
  --private-key $PK
```

## Monitoring

### Execution History

```bash
curl http://localhost:4020/api/v1/agents/1/executions
```

### Costs

```bash
curl http://localhost:4020/api/v1/agents/1/costs
```

## Best Practices

1. **Start small**: Test with minimal funding
2. **Set limits**: Configure spend limits
3. **Monitor**: Watch execution logs
4. **Iterate**: Refine character and triggers
5. **Security**: Use separate wallets for agents

