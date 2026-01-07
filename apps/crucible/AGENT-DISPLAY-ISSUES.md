# Agent Display Issues

**Date:** 2026-01-07
**Branch:** fix/onboarding-issues

## Issue Summary

After deploying an agent via `POST /api/v1/agents`, several display and data issues were observed.

## Test Case

**Request:**
```bash
POST http://127.0.0.1:4021/api/v1/agents
```

**Response:**
```json
{
  "agentId": "101",
  "vaultAddress": "0x4866085cD36523f251Af25BEEcb224F663952EF5",
  "characterCid": "QmZ8AXyG7EPgJBSsX3gcPuVZxA2BmdcbSoviAXRveGkm5R",
  "stateCid": "QmctgUWL9VCNPZ1nz5ExdcqFV8F9MkQGbHDrCmf6JVRn4N"
}
```

## Issues Observed

### Issue 1: Agent Name Display Inconsistency

| Location | Display |
|----------|---------|
| Agent detail page (`/agents/101`) | "auditor" (correct name) |
| Agents overview page | "Agent #101" (generic fallback) |

**Expected:** Both pages should show the agent's actual name from character data.

**Likely cause:** Overview page may not be fetching character CID data or using a different data source.

### Issue 2: Capabilities Not Saved

- User selected "chat" capability during creation
- Agent detail page shows all capabilities as disabled

**Expected:** Selected capabilities should persist and display correctly.

**Investigation needed:**
- Check if capabilities are stored in character CID or on-chain
- Check if the POST /api/v1/agents endpoint accepts/stores capabilities
- Check how the agent detail page fetches capability data

### Issue 3: Vault Funding Source Unclear

- Vault shows 0.01 ETH funding
- Unclear if this is:
  - Localnet auto-funding (expected for dev)
  - Testnet funding (would be unexpected)
  - User-specified initial funding

**Investigation needed:**
- Check `registerAgent()` in `apps/crucible/api/sdk/agent.ts`
- Check if `initialFunding` parameter is being passed
- Verify localnet vs testnet funding behavior

## Files to Investigate

1. **Agent overview page** - Where does it get agent names?
   - `apps/crucible/web/pages/Agents.tsx` or similar
   - Check if it fetches from indexer vs chain vs IPFS

2. **Agent detail page** - How does it load character data?
   - `apps/crucible/web/pages/Agent.tsx` or similar
   - Check capability display logic

3. **Agent registration API** - What data is stored where?
   - `apps/crucible/api/sdk/agent.ts` - `registerAgent()`
   - `apps/crucible/api/server.ts` - POST /api/v1/agents handler

4. **Character schema** - What fields are expected?
   - `apps/crucible/lib/types.ts` - AgentCharacter interface
   - Check if capabilities field exists

## Related Context

- Character CID: `QmZ8AXyG7EPgJBSsX3gcPuVZxA2BmdcbSoviAXRveGkm5R`
- State CID: `QmctgUWL9VCNPZ1nz5ExdcqFV8F9MkQGbHDrCmf6JVRn4N`
- Can fetch character data: `curl http://127.0.0.1:4030/cdn/ipfs/{cid}`

## Priority

Medium - These are UX issues that don't block core functionality but affect user experience and trust in the system.
