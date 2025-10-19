# Integration Tests

Comprehensive E2E tests for the deeply integrated Jeju ecosystem.

## Test Suites

### 1. Deep Integration (`deep-integration.test.ts`)

Tests the complete registry → discovery → connection flow:

- Registry contract deployment
- App registration with staking
- Agent discovery via plugin-registry
- A2A connections
- Skill execution
- Stake withdrawal

**Run:**
```bash
bun test tests/integration/deep-integration.test.ts
```

### 2. Multi-App Workflow (Future)

Tests cross-app workflows enabled by deep integration:

- Agent discovers game (eHorse)
- Agent checks odds on Predimarket
- Agent places bet
- Agent monitors via Monitoring
- Agent trades winnings on Bazaar

### 3. Registry Spam Protection (Future)

Tests staking economics prevent spam:

- Attempt to register without stake (should fail)
- Register with insufficient stake (should fail)
- Register with correct stake (should succeed)
- Mass registration (ensure gas costs + stakes prevent spam)

## Running All Tests

```bash
# Run all integration tests
bun test tests/integration/

# With verbose output
bun test tests/integration/ --verbose

# Watch mode
bun test tests/integration/ --watch
```

## Test Requirements

### Environment
- Jeju localnet running (port 9545)
- All apps deployed and running
- Indexer synced
- Test account funded with:
  - ETH (for gas)
  - elizaOS (for staking)
  - CLANKER (for staking)
  - VIRTUAL (for staking)

### Configuration
```bash
# .env
RPC_URL=http://localhost:9545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
IDENTITY_REGISTRY_ADDRESS=0x... # Set after deployment
ELIZAOS_TOKEN_ADDRESS=0x...
CLANKER_TOKEN_ADDRESS=0x...
VIRTUAL_TOKEN_ADDRESS=0x...
```

## Success Criteria

All tests must pass for the deep integration to be considered complete:

- ✅ Contracts deploy successfully
- ✅ Apps register with stakes
- ✅ Agent discovers all apps
- ✅ A2A endpoints respond
- ✅ Skills execute correctly
- ✅ Stakes refund properly

## Manual Testing Checklist

Since some UI interactions require manual testing:

**Gateway UI:**
- [ ] Open http://localhost:4001
- [ ] Go to Registry tab
- [ ] See list of registered apps
- [ ] Filter by tag (game, marketplace, etc.)
- [ ] Register new app
- [ ] View app details
- [ ] Withdraw stake (as owner)

**Agent UI (Desktop):**
- [ ] Open agent game
- [ ] Go to Registry tab
- [ ] See discovered apps
- [ ] Click on an app
- [ ] See capabilities
- [ ] Chat: "discover apps"
- [ ] Chat: "connect to Bazaar"
- [ ] Chat: "list tokens on Bazaar"

**Agent UI (Browser):**
- [ ] Open http://localhost:4010
- [ ] Agent initializes
- [ ] WebContainer boots
- [ ] Can send messages
- [ ] Registry integration works

**A2A Endpoints:**
- [ ] curl http://localhost:4006/.well-known/agent-card.json
- [ ] curl http://localhost:4007/.well-known/agent-card.json
- [ ] curl http://localhost:4003/.well-known/agent-card.json
- [ ] curl http://localhost:4005/.well-known/agent-card.json

## Debugging

If tests fail:

**Check contracts:**
```bash
# Verify registry deployed
cast call $REGISTRY_ADDRESS "totalAgents()" --rpc-url $RPC_URL

# Check if app registered
cast call $REGISTRY_ADDRESS "agentExists(uint256)" 1 --rpc-url $RPC_URL
```

**Check A2A endpoints:**
```bash
# Bazaar
curl http://localhost:4006/.well-known/agent-card.json

# Call skill
curl -X POST http://localhost:4006/api/a2a \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","params":{"message":{"messageId":"test","parts":[{"kind":"data","data":{"skillId":"list-tokens"}}]}},"id":1}'
```

**Check indexer:**
```bash
# Query registered agents
curl -X POST http://localhost:4350/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ registeredAgents { id name tags } }"}'
```

**Check agent:**
```bash
# Check if plugin loaded
curl http://localhost:7777/api/agents

# Check services
curl http://localhost:7777/api/agents/$AGENT_ID/services
```

## Performance Benchmarks

Target performance metrics:

- Registry query (getAllAgents): < 100ms
- A2A agent card fetch: < 200ms
- A2A skill execution: < 500ms
- Agent discovery (cold): < 2s
- Agent discovery (cached): < 100ms
- Full E2E flow: < 10s

## Known Issues

1. **wagmi v2 Hook Changes** - useContractWrite → useWriteContract
2. **Event Signature Decoding** - Need proper ABI decoder in indexer
3. **Browser CORS** - May need CORS proxy for some A2A calls
4. **WebContainer Limits** - 120MB fs limit may affect some use cases

## Next Steps

1. Implement all TODO comments in test file
2. Add Playwright tests for UI flows
3. Add stress tests (100+ app registrations)
4. Add security tests (unauthorized withdrawals, etc.)
5. Add performance benchmarking

---

*Last Updated: October 19, 2025*  
*Status: Implementation Complete, Testing In Progress*

